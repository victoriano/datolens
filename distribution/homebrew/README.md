# Homebrew distribution

`publish-notarized-beta.py` regenerates `Casks/datolens.rb` from the exact
notarized ZIP, version, build number and SHA-256 that are published on the
Datolens website. The cask installs both `Datolens.app` and the `datolens`
command from the signed application bundle.

The generated cask is a release artifact. Publishing it still requires an
explicitly authorized Homebrew tap/repository; this project does not create or
push that remote automatically.
