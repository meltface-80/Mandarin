/*
 * usb_jni.cc — the native side of the USB audio driver (Stage 9.1: the probe).
 *
 * Android hands an app the open device node of a USB device it has
 * permission for (UsbDeviceConnection.getFileDescriptor()). Everything a
 * driver needs — isochronous transfers above all, which Java has no call
 * for — is done on that descriptor with the kernel's usbdevfs ioctls, the
 * way libusb does it on Linux. This part only asks the node what it can do
 * and how fast the device is attached, to prove the path from the app to
 * the device: 9.2 streams through it.
 */
#include <jni.h>
#include <string>
#include <cstdio>
#include <cstring>
#include <cerrno>
#include <sys/ioctl.h>
#include <linux/usbdevice_fs.h>

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

/* The bus speed the device is attached at: what the packet budget per
 * microframe depends on. Newer kernels answer USBDEVFS_GET_SPEED; older
 * ones only say low or not. */
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
