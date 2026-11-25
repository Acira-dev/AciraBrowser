# Workspace covers

Six covers of the new-tab and workspace pickers, 1536 x 1024, shipped as lossless WebP (`-lossless -z 9`, no metadata).

They are pixel for pixel the PNGs they replaced (14.0, earlier work: 19.49 MB became 13.51 MB). The PNGs carried only an sRGB chunk and a 68-byte EXIF block (ColorSpace sRGB, the pixel size; no orientation, no profile), and an sRGB-tagged image and an untagged WebP both draw as sRGB.

- `SOURCE.sha256`: SHA-256 of each shipped file (`tests/workspace-covers-exact.test.cjs` checks it).
- `PIXELS.sha256`: SHA-256 of each cover's decoded 8-bit RGB (width x height x 3 bytes), taken from the original PNG. To check a file: `dwebp -pam cover.webp -o cover.pam`, drop the alpha byte of every pixel, hash the remaining RGB bytes; it must equal the line here (alpha must be 255 everywhere).
