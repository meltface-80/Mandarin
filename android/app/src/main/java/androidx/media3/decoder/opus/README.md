# Media3's Opus decoder module, in the app

These four files are `libraries/decoder_opus` from
[androidx/media](https://github.com/androidx/media) at 1.8.0 (the Media3
version the app uses), unchanged, under their Apache 2.0 headers. Media3 does
not publish this module as a library — it must be built with libopus — so
it is carried here and built by the app's own native build
(`src/main/cpp/CMakeLists.txt`, which fetches libopus).

Why: Android's own Opus decoder gives 16-bit PCM. This one decodes to float
when the audio sink is float, which is how the server's Opus 256 reaches the
phone's DSP engine and its output at 24/48 (Stage 2 of
docs/specs/roadmap-stages.md). The package name is Media3's because the JNI
symbols in `opus_jni.cc` are named after it, and `DefaultRenderersFactory`
finds `LibopusAudioRenderer` by this name.
