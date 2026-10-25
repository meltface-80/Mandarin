# R8 on the release build (bug list item 158): the libraries it is given — Compose above all, which ran unoptimised
# and partly interpreted, the first frames on Home taking up to 160 ms — are optimised and trimmed. Mandarin's own
# code is kept whole and named as it is: its JNI (the USB DAC, the DSP), the Opus decoder the app builds itself, the
# workers WorkManager makes by name, and every class the manifest names stay exactly as written.
-dontobfuscate
-keep class com.musicd.** { *; }
-keep class androidx.media3.decoder.opus.** { *; }
# Classes the native code calls back into by name, which R8 can't see from Java (item 160: libopus asks for
# SimpleDecoderOutputBuffer.init, and the first Opus track away from home ended the player without it). Every class a
# FindClass in src/main/cpp names is kept here; test/android-r8-native.test.js checks it.
-keep class androidx.media3.decoder.SimpleDecoderOutputBuffer { *; }
-keepclasseswithmembernames class * { native <methods>; }
