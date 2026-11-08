Acira Browser {{VERSION}} for Linux (x86_64)

INSTALL
1. Put {{IMAGE}} in the same folder
   as these setup files.
2. Open a terminal in that folder and run:
     bash Install-Acira.sh
   Run it as yourself, not as root.
3. Open Acira Browser from your app menu.

AppImages need FUSE 2. Ubuntu 22.04 and later don't include it, so if Acira
doesn't open, install it and try again:
  sudo apt install libfuse2t64     (Ubuntu 24.04 and later)
  sudo apt install libfuse2        (Ubuntu 22.04)

The installer checks the files against SHA256SUMS.txt, copies the AppImage to
~/.local/share/acira-browser/AciraBrowser.AppImage and adds Acira to your app
menu. It does not change your default browser.

Your system asks once for administrator permission to install Acira's
PolicyKit policy (computer.acira.browser.policy). The policy lets Acira ask
for your own password before it unlocks a locked workspace or shows a saved
password. It gives Acira no administrator rights, and Acira never sees the
password you type. Saved passwords also need your desktop's keyring, such as
GNOME Keyring or KWallet.

You can also run the AppImage on its own: make it executable
(chmod +x AciraBrowser-*.AppImage) and open it. It runs and updates itself,
but there is no app menu entry, and without the policy Acira can't unlock a
locked workspace or show a saved password.

APPEARANCE
To follow your desktop's light or dark setting and accent color, turn on
Settings > Appearance > Match my system theme.

UPDATES
Acira updates itself. Keep the AppImage where it is, owned by you and
writable. You can check in Settings > About.

UNINSTALL
Quit Acira, then run:
  bash Install-Acira.sh --uninstall
It removes the AppImage and the app menu entry. Your profile and passwords
stay. The PolicyKit policy stays in /usr/share/polkit-1/actions in case
another copy of Acira needs it.

ABOUT THIS BETA
For 64-bit Intel and AMD processors (x86_64). There is no ARM build yet.
So far it has been tested on Ubuntu 24.04. Other distributions should work;
tell us if yours doesn't. The AppImage isn't signed: compare its SHA-256 with
SHA256SUMS.txt on the release page.

Download: https://acirabrowser.com/download/
Help:     https://acirabrowser.com/docs/install/
Source:   https://github.com/Acira-dev/AciraBrowser (AGPL-3.0)
Contact:  support@acirai.com
