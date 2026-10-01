/*
 * usb_jni.cc — the native side of the app's USB audio driver (Stage 9).
 *
 * Android hands an app the open device node of a USB device it has
 * permission for (UsbDeviceConnection.getFileDescriptor()). Everything a
 * driver needs — isochronous transfers above all, which Java has no call
 * for — is done on that descriptor with the kernel's usbdevfs ioctls, the
 * way libusb does it on Linux.
 *
 * 9.1: the probe (capabilities, bus speed). 9.2: the stream. PCM frames are
 * written into a ring from Kotlin; a reaper thread keeps a set of
 * isochronous OUT URBs in flight, each a run of packets sized from the
 * DAC's feedback (an asynchronous DAC says how many frames per packet it
 * wants, in 10.14 or 16.16 fixed point) or from the nominal rate (adaptive
 * and synchronous DACs). What the ring can't supply is sent as silence and
 * counted as an underrun; draining sends what is left and then nothing.
 */
#include <jni.h>
#include <string>
#include <cstdio>
#include <cstring>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cmath>
#include <vector>
#include <mutex>
#include <thread>
#include <atomic>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/usbdevice_fs.h>
#include <android/log.h>

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "UsbDriver", __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, "UsbDriver", __VA_ARGS__)

#ifndef USBDEVFS_CAP_ZERO_PACKET
#define USBDEVFS_CAP_ZERO_PACKET 0x01
#endif
#ifndef USBDEVFS_CAP_BULK_CONTINUATION
#define USBDEVFS_CAP_BULK_CONTINUATION 0x02
#endif
#ifndef USBDEVFS_CAP_NO_PACKET_SIZE_LIM
#define USBDEVFS_CAP_NO_PACKET_SIZE_LIM 0x04
#endif
#ifndef USBDEVFS_CAP_BULK_SCATTER_GATHER
#define USBDEVFS_CAP_BULK_SCATTER_GATHER 0x08
#endif
#ifndef USBDEVFS_CAP_REAP_AFTER_DISCONNECT
#define USBDEVFS_CAP_REAP_AFTER_DISCONNECT 0x10
#endif
#ifndef USBDEVFS_CAP_MMAP
#define USBDEVFS_CAP_MMAP 0x20
#endif
#ifndef USBDEVFS_CAP_DROP_PRIVILEGES
#define USBDEVFS_CAP_DROP_PRIVILEGES 0x40
#endif
#ifndef USBDEVFS_GET_SPEED
#define USBDEVFS_GET_SPEED _IO('U', 31)
#endif

// ------------------------------------------------------------------ probe

extern "C" JNIEXPORT jstring JNICALL
Java_com_musicd_server_android_UsbDac_nativeProbe(JNIEnv* env, jclass, jint fd) {
  char out[512];
  __u32 caps = 0;
  if (ioctl(fd, USBDEVFS_GET_CAPABILITIES, &caps) < 0) {
    snprintf(out, sizeof out, "ioctl GET_CAPABILITIES failed: %s", strerror(errno));
    return env->NewStringUTF(out);
  }
  struct usbdevfs_connectinfo ci;
  memset(&ci, 0, sizeof ci);
  int haveCi = ioctl(fd, USBDEVFS_CONNECTINFO, &ci) == 0;
  snprintf(out, sizeof out,
           "usbdevfs ok: caps=0x%x%s%s%s%s%s%s%s%s",
           caps,
           (caps & USBDEVFS_CAP_ZERO_PACKET) ? " zero-packet" : "",
           (caps & USBDEVFS_CAP_BULK_CONTINUATION) ? " bulk-continuation" : "",
           (caps & USBDEVFS_CAP_NO_PACKET_SIZE_LIM) ? " no-packet-size-limit" : "",
           (caps & USBDEVFS_CAP_BULK_SCATTER_GATHER) ? " scatter-gather" : "",
           (caps & USBDEVFS_CAP_REAP_AFTER_DISCONNECT) ? " reap-after-disconnect" : "",
           (caps & USBDEVFS_CAP_MMAP) ? " mmap" : "",
           (caps & USBDEVFS_CAP_DROP_PRIVILEGES) ? " drop-privileges" : "",
           haveCi ? (ci.slow ? ", low speed" : "") : ", no connectinfo");
  if (haveCi) {
    size_t n = strlen(out);
    snprintf(out + n, sizeof out - n, ", devnum=%u", ci.devnum);
  }
  return env->NewStringUTF(out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_musicd_server_android_UsbDac_nativeSpeed(JNIEnv* env, jclass, jint fd) {
  int s = ioctl(fd, USBDEVFS_GET_SPEED);
  const char* name = "unknown";
  if (s >= 0) {
    switch (s) {
      case 1: name = "low"; break;
      case 2: name = "full"; break;
      case 3: name = "high"; break;
      case 4: name = "wireless"; break;
      case 5: name = "super"; break;
      case 6: name = "super-plus"; break;
      default: name = "other"; break;
    }
  } else {
    struct usbdevfs_connectinfo ci;
    memset(&ci, 0, sizeof ci);
    if (ioctl(fd, USBDEVFS_CONNECTINFO, &ci) == 0) name = ci.slow ? "low" : "full-or-high";
  }
  return env->NewStringUTF(name);
}

// ----------------------------------------------------------------- stream

namespace {

struct Urb {
  usbdevfs_urb* urb = nullptr;   // with its iso_frame_desc tail
  uint8_t* buf = nullptr;
  size_t bufSize = 0;
  int frames = 0;                // PCM frames carried (OUT) — counted when reaped
  bool feedback = false;
  bool inFlight = false;
};

struct Driver {
  int fd = -1;
  int iface = 0, alt = 0;
  int ep = 0, fbEp = 0;
  bool highSpeed = false;
  int interval = 1;        // the data endpoint's bInterval (raw)
  int fbInterval = 1;      // the feedback endpoint's bInterval (raw)
  int maxPacket = 0;       // bytes
  int fbMaxPacket = 4;
  int frameBytes = 0;      // channels * subslot
  int rate = 0;
  int pktsPerUrb = 8, nUrbs = 8;
  double periodUs = 1000;  // between data packets
  double nominal = 0;      // frames per packet, nominal
  double accum = 0;        // fractional frames carried over
  double fbFrames = 0;     // frames per packet the DAC asks for
  bool fbValid = false;
  std::vector<Urb> urbs;
  std::vector<Urb> fburbs;
  // ring of PCM bytes
  std::vector<uint8_t> ring;
  size_t head = 0, tail = 0, fill = 0;
  std::mutex mu;
  std::atomic<bool> running{false}, draining{false}, stopping{false}, dead{false};
  std::thread reaper;
  // stats
  std::atomic<uint64_t> framesQueued{0}, framesDone{0}, underruns{0}, fbUpdates{0}, errors{0}, urbsDone{0};
  std::string lastError;
  bool primed = false;
};

size_t ringFree(Driver* d) { return d->ring.size() - d->fill; }

size_t ringRead(Driver* d, uint8_t* out, size_t n) {
  size_t got = 0;
  while (got < n && d->fill > 0) {
    size_t chunk = std::min(n - got, std::min(d->fill, d->ring.size() - d->head));
    memcpy(out + got, d->ring.data() + d->head, chunk);
    d->head = (d->head + chunk) % d->ring.size();
    d->fill -= chunk; got += chunk;
  }
  return got;
}

size_t ringWrite(Driver* d, const uint8_t* in, size_t n) {
  size_t put = 0;
  while (put < n && d->fill < d->ring.size()) {
    size_t chunk = std::min(n - put, std::min(d->ring.size() - d->fill, d->ring.size() - d->tail));
    memcpy(d->ring.data() + d->tail, in + put, chunk);
    d->tail = (d->tail + chunk) % d->ring.size();
    d->fill += chunk; put += chunk;
  }
  return put;
}

void allocUrb(Urb& u, int packets, size_t packetBytes) {
  size_t sz = sizeof(usbdevfs_urb) + sizeof(usbdevfs_iso_packet_desc) * packets;
  u.urb = (usbdevfs_urb*)calloc(1, sz);
  u.bufSize = packets * packetBytes;
  u.buf = (uint8_t*)calloc(1, u.bufSize ? u.bufSize : 1);
}
void freeUrb(Urb& u) { free(u.urb); free(u.buf); u.urb = nullptr; u.buf = nullptr; }

/* Fill an OUT URB's packets from the ring (silence where it runs dry), sized by the feedback. */
void fillOut(Driver* d, Urb& u) {
  std::lock_guard<std::mutex> lk(d->mu);
  int maxFrames = d->maxPacket / d->frameBytes;
  double want = d->fbValid ? d->fbFrames : d->nominal;
  int total = 0;
  size_t off = 0;
  for (int p = 0; p < d->pktsPerUrb; p++) {
    d->accum += want;
    int n = (int)floor(d->accum);
    d->accum -= n;
    if (n < 0) n = 0;
    if (n > maxFrames) n = maxFrames;
    size_t bytes = (size_t)n * d->frameBytes;
    size_t got = 0;
    if (d->draining && d->fill == 0) { bytes = 0; n = 0; }
    else {
      got = ringRead(d, u.buf + off, bytes);
      if (got < bytes) {
        if (d->draining) { bytes = got - got % d->frameBytes; n = (int)(bytes / d->frameBytes); }
        else { memset(u.buf + off, 0, bytes - got); d->underruns++; }
      }
    }
    u.urb->iso_frame_desc[p].length = (unsigned)bytes;
    u.urb->iso_frame_desc[p].actual_length = 0;
    u.urb->iso_frame_desc[p].status = 0;
    off += bytes;
    total += n;
  }
  u.frames = total;
  u.urb->buffer_length = (int)off;
  d->framesQueued += total;
}

bool submit(Driver* d, Urb& u, bool out) {
  u.urb->type = USBDEVFS_URB_TYPE_ISO;
  u.urb->endpoint = out ? d->ep : d->fbEp;
  u.urb->flags = USBDEVFS_URB_ISO_ASAP;
  u.urb->buffer = u.buf;
  u.urb->number_of_packets = out ? d->pktsPerUrb : 1;
  u.urb->usercontext = &u;
  u.urb->signr = 0;
  if (!out) {
    u.urb->iso_frame_desc[0].length = d->fbMaxPacket;
    u.urb->buffer_length = d->fbMaxPacket;
  }
  if (ioctl(d->fd, USBDEVFS_SUBMITURB, u.urb) < 0) {
    d->errors++;
    d->lastError = std::string(out ? "submit out: " : "submit feedback: ") + strerror(errno);
    if (errno == ENODEV || errno == ESHUTDOWN) d->dead = true;
    u.inFlight = false;
    return false;
  }
  u.inFlight = true;
  return true;
}

/* The DAC's feedback value → frames per data packet. */
void takeFeedback(Driver* d, Urb& u) {
  unsigned len = u.urb->iso_frame_desc[0].actual_length;
  if (u.urb->iso_frame_desc[0].status != 0 || (len != 3 && len != 4)) return;
  uint32_t v = 0;
  for (unsigned i = 0; i < len; i++) v |= (uint32_t)u.buf[i] << (8 * i);
  double perUnit;   // frames per bus frame (full speed, 10.14 per ms) or per microframe (high speed, 16.16)
  if (!d->highSpeed) perUnit = (double)v / 16384.0;
  else if (len == 4) perUnit = (double)v / 65536.0;
  else perUnit = (double)v / 16384.0 / 8.0;   // a 10.14 per-ms value on a high-speed link
  double unitUs = d->highSpeed ? 125.0 : 1000.0;
  double frames = perUnit * (d->periodUs / unitUs);
  // Sanity: within a fifth of nominal, or it is noise.
  if (frames > d->nominal * 0.8 && frames < d->nominal * 1.2) {
    std::lock_guard<std::mutex> lk(d->mu);
    d->fbFrames = frames; d->fbValid = true; d->fbUpdates++;
  }
}

void reaperLoop(Driver* d) {
  while (!d->stopping) {
    usbdevfs_urb* done = nullptr;
    int r = ioctl(d->fd, USBDEVFS_REAPURB, &done);
    if (r < 0) {
      if (errno == EINTR || errno == EAGAIN) continue;
      if (errno == ENODEV || errno == ESHUTDOWN) { d->dead = true; d->lastError = "device gone"; break; }
      d->errors++;
      if (d->stopping) break;
      continue;
    }
    if (!done) continue;
    Urb* u = (Urb*)done->usercontext;
    u->inFlight = false;
    if (d->stopping) continue;
    if (u->feedback) {
      takeFeedback(d, *u);
      submit(d, *u, false);
    } else {
      d->urbsDone++;
      d->framesDone += u->frames;
      if (done->status != 0 && done->status != -ENOENT) d->errors++;
      if (d->running) { fillOut(d, *u); submit(d, *u, true); }
    }
  }
}

void discardAll(Driver* d) {
  for (auto& u : d->urbs) if (u.inFlight) ioctl(d->fd, USBDEVFS_DISCARDURB, u.urb);
  for (auto& u : d->fburbs) if (u.inFlight) ioctl(d->fd, USBDEVFS_DISCARDURB, u.urb);
}

void stopThread(Driver* d) {
  d->stopping = true;
  d->running = false;
  discardAll(d);
  if (d->reaper.joinable()) d->reaper.join();
  // Anything still outstanding after the discard: reap it so the kernel frees it.
  int left = 0;
  for (auto& u : d->urbs) if (u.inFlight) left++;
  for (auto& u : d->fburbs) if (u.inFlight) left++;
  while (left > 0 && !d->dead) {
    usbdevfs_urb* done = nullptr;
    if (ioctl(d->fd, USBDEVFS_REAPURBNDELAY, &done) < 0) { if (errno == EAGAIN) { usleep(1000); continue; } break; }
    if (done) { ((Urb*)done->usercontext)->inFlight = false; left--; }
  }
  d->stopping = false;
}

Driver* get(jlong h) { return (Driver*)(intptr_t)h; }

}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_musicd_server_android_UsbDriver_nativeOpen(JNIEnv*, jclass, jint fd, jint iface, jint alt, jint ep, jint fbEp,
                                                      jboolean highSpeed, jint interval, jint fbInterval, jint maxPacket,
                                                      jint fbMaxPacket, jint frameBytes, jint rate) {
  Driver* d = new Driver();
  d->fd = fd; d->iface = iface; d->alt = alt; d->ep = ep; d->fbEp = fbEp; d->highSpeed = highSpeed;
  d->interval = interval > 0 ? interval : 1; d->fbInterval = fbInterval > 0 ? fbInterval : 1;
  d->maxPacket = maxPacket; d->fbMaxPacket = fbMaxPacket > 0 ? fbMaxPacket : (highSpeed ? 4 : 3);
  d->frameBytes = frameBytes; d->rate = rate;
  // A packet every bInterval ms at full speed, every 2^(bInterval-1) microframes at high speed.
  d->periodUs = highSpeed ? 125.0 * (1 << (d->interval - 1)) : 1000.0 * d->interval;
  d->nominal = (double)rate * d->periodUs / 1e6;
  // About 64 ms in flight, in URBs of about 4–8 ms.
  int pktsPer8ms = (int)std::max(1.0, floor(8000.0 / d->periodUs));
  d->pktsPerUrb = std::min(pktsPer8ms, 64);
  d->nUrbs = std::max(4, (int)ceil(64000.0 / (d->periodUs * d->pktsPerUrb)));
  if (d->nUrbs > 32) d->nUrbs = 32;
  // Select the streaming alternate setting (bandwidth is claimed here).
  usbdevfs_setinterface si; si.interface = iface; si.altsetting = alt;
  if (ioctl(fd, USBDEVFS_SETINTERFACE, &si) < 0) {
    LOGW("set alt %d/%d: %s", iface, alt, strerror(errno));
    delete d; return 0;
  }
  d->ring.assign((size_t)rate * frameBytes * 2, 0);   // two seconds
  d->urbs.resize(d->nUrbs);
  for (auto& u : d->urbs) allocUrb(u, d->pktsPerUrb, (size_t)maxPacket);
  if (fbEp) {
    d->fburbs.resize(2);
    for (auto& u : d->fburbs) { allocUrb(u, 1, (size_t)d->fbMaxPacket); u.feedback = true; }
  }
  LOGI("open: rate %d, %d B/frame, period %.0f us, nominal %.3f frames/packet, %d x %d packets, max %d B%s",
       rate, frameBytes, d->periodUs, d->nominal, d->nUrbs, d->pktsPerUrb, maxPacket, fbEp ? ", feedback" : "");
  return (jlong)(intptr_t)d;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_musicd_server_android_UsbDriver_nativePlay(JNIEnv*, jclass, jlong h) {
  Driver* d = get(h); if (!d || d->dead) return JNI_FALSE;
  if (d->running) return JNI_TRUE;
  d->draining = false;
  d->running = true;
  d->stopping = false;
  for (auto& u : d->fburbs) if (!u.inFlight) submit(d, u, false);
  for (auto& u : d->urbs) if (!u.inFlight) { fillOut(d, u); if (!submit(d, u, true)) break; }
  if (!d->reaper.joinable()) d->reaper = std::thread(reaperLoop, d);
  return d->dead ? JNI_FALSE : JNI_TRUE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_musicd_server_android_UsbDriver_nativePause(JNIEnv*, jclass, jlong h) {
  Driver* d = get(h); if (!d) return;
  if (!d->running && !d->reaper.joinable()) return;
  stopThread(d);
  d->accum = 0;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_musicd_server_android_UsbDriver_nativeWrite(JNIEnv* env, jclass, jlong h, jobject buf, jint off, jint len) {
  Driver* d = get(h); if (!d || d->dead) return -1;
  uint8_t* p = (uint8_t*)env->GetDirectBufferAddress(buf);
  if (!p) return -1;
  std::lock_guard<std::mutex> lk(d->mu);
  size_t n = ringWrite(d, p + off, (size_t)len);
  n -= n % d->frameBytes;
  return (jint)n;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_musicd_server_android_UsbDriver_nativeFree(JNIEnv*, jclass, jlong h) {
  Driver* d = get(h); if (!d) return 0;
  std::lock_guard<std::mutex> lk(d->mu);
  return (jint)ringFree(d);
}

/* Frames not yet heard: in the ring and in flight. */
extern "C" JNIEXPORT jlong JNICALL
Java_com_musicd_server_android_UsbDriver_nativePending(JNIEnv*, jclass, jlong h) {
  Driver* d = get(h); if (!d) return 0;
  std::lock_guard<std::mutex> lk(d->mu);
  uint64_t inRing = d->fill / d->frameBytes;
  uint64_t inFlight = d->framesQueued - d->framesDone;
  return (jlong)(inRing + inFlight);
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_musicd_server_android_UsbDriver_nativePlayed(JNIEnv*, jclass, jlong h) {
  Driver* d = get(h); if (!d) return 0;
  return (jlong)d->framesDone.load();
}

extern "C" JNIEXPORT void JNICALL
Java_com_musicd_server_android_UsbDriver_nativeDrain(JNIEnv*, jclass, jlong h) {
  Driver* d = get(h); if (d) d->draining = true;
}

extern "C" JNIEXPORT void JNICALL
Java_com_musicd_server_android_UsbDriver_nativeFlush(JNIEnv*, jclass, jlong h) {
  Driver* d = get(h); if (!d) return;
  bool was = d->running;
  if (was) stopThread(d);
  {
    std::lock_guard<std::mutex> lk(d->mu);
    d->head = d->tail = d->fill = 0;
    d->framesQueued = 0; d->framesDone = 0; d->accum = 0;
    d->draining = false;
  }
  if (was) {
    d->running = true;
    for (auto& u : d->fburbs) if (!u.inFlight) submit(d, u, false);
    for (auto& u : d->urbs) if (!u.inFlight) { fillOut(d, u); if (!submit(d, u, true)) break; }
    d->reaper = std::thread(reaperLoop, d);
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_musicd_server_android_UsbDriver_nativeClose(JNIEnv*, jclass, jlong h) {
  Driver* d = get(h); if (!d) return;
  stopThread(d);
  usbdevfs_setinterface si; si.interface = d->iface; si.altsetting = 0;
  ioctl(d->fd, USBDEVFS_SETINTERFACE, &si);
  for (auto& u : d->urbs) freeUrb(u);
  for (auto& u : d->fburbs) freeUrb(u);
  delete d;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_musicd_server_android_UsbDriver_nativeStats(JNIEnv* env, jclass, jlong h) {
  Driver* d = get(h);
  if (!d) return env->NewStringUTF("{}");
  char out[768];
  double fb;
  { std::lock_guard<std::mutex> lk(d->mu); fb = d->fbValid ? d->fbFrames : 0; }
  snprintf(out, sizeof out,
           "{\"rate\":%d,\"frame_bytes\":%d,\"period_us\":%.0f,\"nominal\":%.3f,\"feedback\":%.4f,\"feedback_updates\":%llu,"
           "\"urbs\":%d,\"packets_per_urb\":%d,\"max_packet\":%d,\"queued\":%llu,\"done\":%llu,\"urbs_done\":%llu,"
           "\"underruns\":%llu,\"errors\":%llu,\"running\":%s,\"draining\":%s,\"dead\":%s,\"ring_fill\":%zu,\"last_error\":\"%s\"}",
           d->rate, d->frameBytes, d->periodUs, d->nominal, fb, (unsigned long long)d->fbUpdates.load(),
           d->nUrbs, d->pktsPerUrb, d->maxPacket, (unsigned long long)d->framesQueued.load(), (unsigned long long)d->framesDone.load(),
           (unsigned long long)d->urbsDone.load(), (unsigned long long)d->underruns.load(), (unsigned long long)d->errors.load(),
           d->running ? "true" : "false", d->draining ? "true" : "false", d->dead ? "true" : "false", d->fill, d->lastError.c_str());
  return env->NewStringUTF(out);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_musicd_server_android_UsbDriver_nativeDead(JNIEnv*, jclass, jlong h) {
  Driver* d = get(h); return (d && d->dead) ? JNI_TRUE : JNI_FALSE;
}
