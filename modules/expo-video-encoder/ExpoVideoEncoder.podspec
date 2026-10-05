Pod::Spec.new do |s|
  s.name = "ExpoVideoEncoder"
  s.version = "0.1.0"
  s.summary = "Encodes RGBA frames into an H.264 MP4."
  s.description = "Turns frames drawn in JS (the trip pass animation) into a shareable MP4 with AVAssetWriter."
  s.license = { :type => "MIT" }
  s.author = "NomadSafe"
  s.homepage = "https://github.com/expo/expo"
  s.platforms = { :ios => "16.4" }
  s.swift_version = "5.9"
  s.source = { :git => "https://github.com/expo/expo.git" }
  s.static_framework = true
  s.dependency "ExpoModulesCore"
  s.frameworks = "AVFoundation", "CoreMedia", "CoreVideo", "Accelerate"
  s.source_files = "ios/**/*.{h,m,mm,swift}"
end
