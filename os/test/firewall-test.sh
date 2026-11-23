#!/bin/bash
# os/test/firewall-test.sh [nftables.conf] — Mandarin OS's firewall (etc/nftables.conf) between two network namespaces,
# the box and a speaker on the home network (item 389): a speaker answers Mandarin's search for it (M-SEARCH) from a
# port of its own, as Sonos does, and the answer must reach the box (it didn't, and Sonos was never found); Mandarin's
# port answers; nothing answers on SSH's. Needs root, ip, nft, python3.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
CONF="${1:-$here/../mkosi.extra/etc/nftables.conf}"
T="$(mktemp -d)"
cleanup() { ip netns del fw-box 2>/dev/null; ip netns del fw-lan 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; exit 1; }
ip netns add fw-box && ip netns add fw-lan && ip link add fw-a type veth peer name fw-b && ip link set fw-a netns fw-box && ip link set fw-b netns fw-lan \
  && ip -n fw-box addr add 192.168.77.2/24 dev fw-a && ip -n fw-lan addr add 192.168.77.3/24 dev fw-b \
  && ip -n fw-box link set fw-a up && ip -n fw-lan link set fw-b up && ip -n fw-box link set lo up || fail "the namespaces couldn't be made"
ip netns exec fw-box nft -f "$CONF" || fail "the firewall's rules don't load"

cat > "$T/speaker.py" <<'PY'
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("0.0.0.0", 1900)); s.settimeout(8)
try:
    d, addr = s.recvfrom(2048)
    a = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); a.bind(("0.0.0.0", 0))
    a.sendto(b"HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:ZonePlayer:1\r\nLOCATION: http://192.168.77.3:1400/xml/device_description.xml\r\n\r\n", addr)
except socket.timeout:
    pass
PY
cat > "$T/search.py" <<'PY'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("0.0.0.0", 0)); s.settimeout(3)
s.sendto(b"M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n", ("192.168.77.3", 1900))
try:
    s.recvfrom(2048)
except socket.timeout:
    sys.exit(1)
PY
cat > "$T/listen.py" <<'PY'
import socket, sys
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("0.0.0.0", int(sys.argv[1]))); s.listen(1); s.settimeout(8)
try:
    c, _ = s.accept(); c.sendall(b"hello"); c.close()
except socket.timeout:
    pass
PY
cat > "$T/connect.py" <<'PY'
import socket, sys
try:
    socket.create_connection(("192.168.77.2", int(sys.argv[1])), timeout=3).recv(5); print("open")
except Exception:
    print("closed")
PY

ip netns exec fw-lan python3 "$T/speaker.py" & sleep 0.5
ip netns exec fw-box python3 "$T/search.py" || fail "a speaker's answer from a port of its own didn't reach the box (Sonos wouldn't be found)"
wait; echo "ok: a speaker's answer to Mandarin's search reaches the box"
for p in 3500 445; do
  ip netns exec fw-box python3 "$T/listen.py" "$p" & sleep 0.5
  [ "$(ip netns exec fw-lan python3 "$T/connect.py" "$p")" = open ] || fail "port $p isn't reachable from home"
  wait; echo "ok: port $p reachable from home"
done
ip netns exec fw-box python3 "$T/listen.py" 22 & sleep 0.5
[ "$(ip netns exec fw-lan python3 "$T/connect.py" 22)" = closed ] || fail "SSH's port is reachable, even with something listening on it"
kill %1 2>/dev/null; wait 2>/dev/null; echo "ok: SSH's port closed, even with something listening on it"
echo PASS
