package main

import (
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"sync"

	"tailscale.com/net/netmon"
)

// Android 11+ doesn't let apps list network interfaces from native code, so
// the app lists them in Java (NetworkInterface) and hands them over as text,
// one per line:  name index mtu up|loopback|multicast addr/bits,addr/bits
var (
	ifMu     sync.Mutex
	ifList   []netmon.Interface
	ifCalls  int
)

func SetInterfaces(desc string) error {
	var out []netmon.Interface
	for _, line := range strings.Split(strings.TrimSpace(desc), "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		idx, err1 := strconv.Atoi(f[1])
		mtu, err2 := strconv.Atoi(f[2])
		if err1 != nil || err2 != nil {
			return fmt.Errorf("bad interface line %q", line)
		}
		var flags net.Flags
		for _, fl := range strings.Split(f[3], "|") {
			switch fl {
			case "up":
				flags |= net.FlagUp | net.FlagRunning
			case "loopback":
				flags |= net.FlagLoopback
			case "multicast":
				flags |= net.FlagMulticast
			case "broadcast":
				flags |= net.FlagBroadcast
			}
		}
		ni := netmon.Interface{Interface: &net.Interface{Index: idx, MTU: mtu, Name: f[0], Flags: flags}}
		if len(f) > 4 {
			for _, a := range strings.Split(f[4], ",") {
				p, err := netip.ParsePrefix(a)
				if err != nil {
					return fmt.Errorf("bad address %q", a)
				}
				ni.AltAddrs = append(ni.AltAddrs, &net.IPNet{IP: p.Addr().AsSlice(), Mask: net.CIDRMask(p.Bits(), p.Addr().BitLen())})
			}
		}
		out = append(out, ni)
	}
	ifMu.Lock()
	ifList = out
	ifMu.Unlock()
	return nil
}

// InstallInterfaceGetter makes Tailscale use the list above (call before Start).
func InstallInterfaceGetter() {
	netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
		ifMu.Lock()
		defer ifMu.Unlock()
		ifCalls++
		return append([]netmon.Interface(nil), ifList...), nil
	})
}

func InterfaceCalls() int { ifMu.Lock(); defer ifMu.Unlock(); return ifCalls }
