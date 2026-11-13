# Mandarin OS

Mandarin on a computer of its own, a lightweight system made only to run it, with its own page to look after it: write the image to a USB stick, start the computer from it, answer
a few questions, and the computer is a Mandarin server with nothing else to look after (item 389's plan, phase 3).

* **Hardware:** a 64-bit Intel or AMD computer with UEFI and a wired network (an Intel NUC, a Dell OptiPlex Micro, a
  mini PC). Secure Boot off for now. Its own disk for the system; another internal disk, if any, can be internal storage.
* **What it is:** Debian 13 (trixie), Mandarin installed natively (`tools/linux/install.sh`), its data on a partition of
  its own (`/data`), and only what Mandarin needs: no desktop, no login, **no SSH** (never installed).
* **On the network:** Mandarin at `http://mandarin:3500`, the system page at `http://mandarin/`, the share at
  `smb://mandarin/data` (`\\mandarin\Data`) for the user and password chosen at install. Found as `mandarin.local` (Bonjour)
  and by Windows (WS-Discovery).
* **The share:** `Storage` to copy music into (`USB/<drive>` for each USB drive, `Internal` for internal storage), and the
  logs: `MandarinServer`, `MandarinBridge`, `MandarinApp`, `MandarinOS`, read-only.
* **USB drives** are mounted as they are plugged in (ext4, exFAT, FAT, NTFS; HFS+ read-only), checked first; one that
  can't be repaired is mounted read-only.
* **Looks after itself:** every week, when nothing plays, a newer Mandarin OS (below), or else Debian's security
  updates, what nothing needs removed, a restart only if an update needs it, and a check that everything works,
  repairing what doesn't (`maintain`). Silent.
* **Updates itself in place** (0.1.4, `os-update`): below.
* **The screen:** says where to find Mandarin. Type `networkreset` there to put the network back to DHCP (a static address
  that lost the box), or `passwordreset` for Mandarin's forgotten password. Nothing else is taken there.
* **Firewall:** everything in is refused but what Mandarin and the system answer (`etc/nftables.conf`).

## Writing the USB stick

The image is published twice, the same either way: `mandarin-os-<version>-x64.img` as it is (about 1.6 GB), and
`mandarin-os-<version>-x64.img.xz` compressed (about 380 MB). The stick needs 4 GB or more; everything on it is replaced.

* **From an Android phone** (EtchDroid, with a USB-C or OTG adapter): the **`.img`**. A phone's writer doesn't
  decompress, and a stick written from the `.img.xz` holds compressed bytes that no computer starts from.
* **balenaEtcher or Raspberry Pi Imager** on a computer: either; they decompress the `.img.xz` themselves.
* **Linux:** `xz -dc mandarin-os-<version>-x64.img.xz | sudo dd of=/dev/sdX bs=4M conv=fsync status=progress`
  (`lsblk` first: `sdX` is the stick, and all of it is overwritten).

Then start the computer from the stick (a Dell: F12 at the logo, then the stick under UEFI). The installer's screen says
the version it installs.

## Building

```
sudo os/build.sh          # os/mandarin-os_<version>.raw; needs mkosi 25+, systemd-boot, ukify, the network
sudo os/test/boot-test.sh os/mandarin-os_<version>.raw   # installed and started in QEMU, then checked
os/test/next-mandarin.sh /tmp/next                        # Mandarin as this checkout, but 9.9.9 (not as root)
sudo env "PATH=$PATH" os/test/boot-test.sh os/mandarin-os_<version>.raw /tmp/next/mandarin-server   # and updated in the app
```

Given the next Mandarin, the boot test also updates the installed Mandarin as Settings → Updates does, from a stand-in
GitHub on the computer it runs on (`os/test/fake-release.js`), with a key of its own written into its copy of the
installed disk alone (never the image), and checks Mandarin comes back as 9.9.9 with its library and account
(`os/test/in-app-update.js`). Once installed, that is the only way Mandarin gets newer.

CI builds it on every change to `os/` (`.github/workflows/os-image.yml`), tests it the same way, and puts dev's on the
`test-os` pre-release. A numbered release (`mandarin-os-vX.Y.Z`) is made by hand, with the version in `os/VERSION` and its
notes in `os/CHANGELOG.md`. Every change to Mandarin OS raises its patch number (0.1.0, then 0.1.1, …), so the image on
`test-os` always says which it is.

## Layout

| Partition | Size | |
|---|---|---|
| EFI | 512 MB | systemd-boot, the kernel (one unified image) |
| mandarin-os_<version> | 4 GB | the system |
| _empty, then mandarin-os_<next version> | 4 GB | the next version, written there by an update |
| mandarin-data | the rest | `/data`: Mandarin's data and logs, the share, Storage |

The installer (`usr/lib/mandarin-os/install`) writes it with `systemd-repart` from the stick itself
(`install.repart.d`). `mandarin-install.json` on the stick's EFI partition answers every question (unattended). Each
installed version starts from an entry of its own on the EFI partition (`loader/entries/mandarin-os_<version>.conf`,
its kernel image in `EFI/mandarin-os/`) naming its own partition by PARTUUID (`boot.sh`); systemd-boot starts the
newest.

## Updates in place

`os-update check|apply|auto` (item 401): the newest `mandarin-os-v*` release (a test image: the `test-os`
pre-release), when newer than `/usr/lib/mandarin-os/VERSION`. Its system partition (`.root.raw.xz`) and kernel image
(`.efi`), downloaded into `/data/MandarinOS/update`, each checked against its `.sha256` and its `.sig` (Mandarin's
release key); written into the system partition not running (never the one running, never anything else), read back,
grown, labelled `mandarin-os_<version>`; the box's own carried into it (`/etc/fstab`, `/etc/machine-id`, Samba's
records, NetworkManager's connections, Mandarin Bridge and its identity, and `/opt/mandarin` where the one running is
newer); its kernel image and an entry with three tries (`mandarin-os_<version>+3.conf`, systemd's boot counting) put on
the EFI partition; the computer started again. Users are never copied: Mandarin's user is 3500, the shared folder's
3501 and its group 3502 in every version, and an update that numbers them otherwise is refused.

On a start being tried, `mandarin-os-health.service` (`os-started health`) checks what the box needs before
`boot-complete.target`, where systemd-bless-boot keeps the version; anything missing starts the computer again. After
three tries systemd-boot starts the version before, untouched on its own partition, and `os-started boot` says so for
the system page and takes the failed entry off. The kernel's panic and the emergency mode (in the initrd too) start the
computer again rather than wait (`mkosi.conf`). The system page's Settings tab asks it (`system-page/os_update.py`):
**Update and restart**, **Check for updates**; a daily timer checks, and the weekly upkeep runs `auto`. It never starts
the computer again while apt or dpkg is at work (unattended-upgrade, not unattended-upgrades' own shutdown service), and
the upkeep leaves Debian's updates for the next week while an update asked for on the system page is under way.

The boot test proves it end to end (`os/test/os-update-vm.sh`): a 9.9.9 and a broken 9.9.10 made from the image under
test and signed with a key of its own, from a stand-in GitHub (`os/test/fake-os-release.js`), the installed disk told of
them by a drop-in in the test's own copy of it.
