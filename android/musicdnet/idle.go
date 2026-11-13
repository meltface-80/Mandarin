// The engine stops itself (item 404), on the phone only: not on the app's
// timers, which Android freezes with the app.
//
// On 13 Nov 2026 Android ended the app twice for the engine's CPU (65% of a
// core, then 28%, over five minutes), both times with nothing going through
// it but the app's long polls, or nothing at all: the app's at-home stop
// waited on a timer on its main thread, and the app, cached, never ran it.
// Now the engine looks at itself every Tick and exits, its sign-in kept on
// disk (the app starts it again in seconds when it is wanted):
//
//   - idle: for IdleAfter nothing has gone through its forward but the app's
//     background requests (long polls and state reports, a few hundred bytes
//     each, under BusyBytes in a Tick, where audio, covers and pages are far
//     more), and the app's lease (POST /keep, renewed while the app is on
//     screen or the phone's player plays) has run out;
//   - CPU: over the last CPUWindow it used more than CPUShare of a core with
//     nothing passing through: what it was doing goes to the app's log
//     (stopreport.go), rather than Android ending the whole app for it.
package main

import (
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"time"
)

type watchConfig struct {
	Tick      time.Duration // how often it looks
	IdleAfter time.Duration // nothing real through the forward and no lease for this long: it stops
	BusyBytes int64         // bytes through the forward in one Tick that are real use, not a long poll
	CPUWindow time.Duration // the CPU guard's window
	CPUShare  float64       // of one core, over the window, with nothing passing through: it stops
}

// Android ends a background app whose child uses more than 25% of a core over
// five minutes; the guard acts on 20% over one.
var defaultWatch = watchConfig{
	Tick:      15 * time.Second,
	IdleAfter: 150 * time.Second,
	BusyBytes: 16 << 10,
	CPUWindow: time.Minute,
	CPUShare:  0.20,
}

const (
	stopIdle = "idle"
	stopCPU  = "cpu"
)

type cpuSample struct {
	at  time.Time
	cpu float64
}

// watcher decides; the clock, the CPU reader and the bytes counter are given,
// so that tests drive it.
type watcher struct {
	cfg   watchConfig
	now   func() time.Time
	cpu   func() float64
	moved func() int64

	mu        sync.Mutex
	keepUntil time.Time
	lastBusy  time.Time
	lastMoved int64
	samples   []cpuSample
}

func newWatcher(cfg watchConfig, now func() time.Time, cpu func() float64, moved func() int64) *watcher {
	t := now()
	return &watcher{cfg: cfg, now: now, cpu: cpu, moved: moved, lastBusy: t, lastMoved: moved(),
		samples: []cpuSample{{t, cpu()}}}
}

// keep is the app's lease: the engine is wanted for d from now (0 lets it go).
func (w *watcher) keep(d time.Duration) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.keepUntil = w.now().Add(d)
}

// step is one look: "" to go on, or stopIdle / stopCPU and why.
func (w *watcher) step() (kind, why string) {
	now, c, m := w.now(), w.cpu(), w.moved()
	w.mu.Lock()
	defer w.mu.Unlock()
	if m-w.lastMoved >= w.cfg.BusyBytes {
		w.lastBusy = now
	}
	w.lastMoved = m
	w.samples = append(w.samples, cpuSample{now, c})
	// The newest sample at least a window old: what the CPU is measured from.
	from := -1
	for i := len(w.samples) - 1; i >= 0; i-- {
		if now.Sub(w.samples[i].at) >= w.cfg.CPUWindow {
			from = i
			break
		}
	}
	if from >= 0 {
		s := w.samples[from]
		w.samples = w.samples[from:]
		span := now.Sub(s.at).Seconds()
		used := c - s.cpu
		if c >= 0 && s.cpu >= 0 && span > 0 && used/span > w.cfg.CPUShare && !w.lastBusy.After(s.at) {
			return stopCPU, fmt.Sprintf("%.1f s of CPU in the last %.0f s, %.0f%% of a core, with nothing passing through",
				used, span, 100*used/span)
		}
	}
	if idle := now.Sub(w.lastBusy); idle >= w.cfg.IdleAfter && !now.Before(w.keepUntil) {
		return stopIdle, fmt.Sprintf("nothing but the app's background requests through it for %s, and the app not using it",
			idle.Round(time.Second))
	}
	return "", ""
}

// run looks every Tick until a look says stop, then stops with it.
func (w *watcher) run(stop func(kind, why string)) {
	t := time.NewTicker(w.cfg.Tick)
	defer t.Stop()
	for range t.C {
		if kind, why := w.step(); kind != "" {
			stop(kind, why)
			return
		}
	}
}

// watchItself starts the watch (the phone's engine; MusicD Server's never stops itself).
func (e *engine) watchItself(cfg watchConfig) {
	e.watch = newWatcher(cfg, time.Now, cpuSeconds, e.moved.Load)
	go e.watch.run(e.stopSelf)
}

// keep: the app's lease, for /keep; false when the engine doesn't watch itself.
func (e *engine) keep(d time.Duration) bool {
	if e.watch == nil {
		return false
	}
	e.watch.keep(d)
	return true
}

// counted counts what is read through it, for the watch.
type counted struct {
	r io.Reader
	n *atomic.Int64
}

func (c counted) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	if n > 0 && c.n != nil {
		c.n.Add(int64(n))
	}
	return n, err
}
