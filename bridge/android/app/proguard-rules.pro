# R8 on the release build: the libraries are optimised and trimmed; the app's
# own code and Mandarin's driver are kept whole and named as written — the
# driver's JNI (UsbDriver, UsbDac) is found by name from usb_jni.cc.
-dontobfuscate
-keep class com.musicd.** { *; }
-keepclasseswithmembernames class * { native <methods>; }
