# R8 on the release build (bug list item 158): the libraries it is given — Compose above all, which ran unoptimised
# and partly interpreted, the first frames on Home taking up to 160 ms — are optimised and trimmed. Mandarin's own
# code is kept whole and named as it is: its JNI (the USB DAC, the DSP), the Opus decoder the app builds itself, the
# workers WorkManager makes by name, and every class the manifest names stay exactly as written.
-dontobfuscate
-keep class com.musicd.** { *; }
-keep class androidx.media3.decoder.opus.** { *; }
-keepclasseswithmembernames class * { native <methods>; }
