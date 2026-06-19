Pod::Spec.new do |s|
  s.name = "ExpoMemoryInfo"
  s.version = "0.1.0"
  s.summary = "Runtime available memory for local AI capacity."
  s.description = "Reports runtime memory headroom to configure local model context windows."
  s.license = { :type => "MIT" }
  s.author = "NomadSafe"
  s.homepage = "https://github.com/expo/expo"
  s.platforms = { :ios => "16.4" }
  s.swift_version = "5.9"
  s.source = { :git => "https://github.com/expo/expo.git" }
  s.static_framework = true
  s.dependency "ExpoModulesCore"
  s.source_files = "ios/**/*.{h,m,mm,swift}"
end
