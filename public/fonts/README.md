# Bundled fonts

These Latin variable WOFF2 files are the Schibsted Grotesk and JetBrains Mono
assets previously served by `next/font/google`, extracted from the successful
frontend build. Bundling them keeps Docker builds independent of Google Fonts
availability. Both fonts use the SIL Open Font License 1.1; copies are included.

Upstream sources and licenses:

- https://github.com/google/fonts/tree/main/ofl/schibstedgrotesk
- https://github.com/google/fonts/tree/main/ofl/jetbrainsmono

Schibsted Grotesk supports weights 400 through 900. JetBrains Mono supports
weights 100 through 800. The app requests the Latin subset for both families.
