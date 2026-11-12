# Mandarin OS changelog

## Unreleased

- New - passwordreset at the box's screen: Mandarin's account removed and every device signed out, for a password forgotten (there is no shell to run reset-password in); the login page says so on Mandarin OS. Mandarin knows it runs on Mandarin OS (MANDARIN_OS)
- Fixed - the USB stick started with a screen of "Timed out waiting" and "Dependency failed", taken for an error, and only then the installer, about half a minute later: it waited for a data partition and internal storage only an installed system has, and tried to mount its own partitions as music drives. Those mounts are written into the installed system by the installer now; on the stick nothing waits for them and nothing that needs them starts. The installer comes as soon as the stick has started, without waiting for the network, and the screen shows the installer or where to find Mandarin and nothing else (systemd's start-up lines go to the serial port). The system's own disk and Mandarin OS's own partitions are never mounted as USB drives. And an installed system no longer waits about two minutes at every start for systemd-networkd, which ran beside NetworkManager, managed nothing, and failed after its wait; NetworkManager alone runs the network

## v0.1.0

- New - Mandarin OS: Debian 13 with Mandarin installed natively, installed from a USB stick onto a computer's own disk; the share smb://mandarin/data for the user chosen at install, laid out as ROCK's Data share (Storage to copy music into, the logs read-only); USB drives mounted as they are plugged in, checked first; found as mandarin.local and by Windows; no login and no SSH, everything else closed by a firewall; a weekly upkeep, when nothing plays, of security updates and clean-up, restarting only when an update needs it and repairing whatever doesn't work after; networkreset at the screen for a static address that lost it
