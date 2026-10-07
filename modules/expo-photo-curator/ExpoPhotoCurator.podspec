Pod::Spec.new do |s|
  s.name = "ExpoPhotoCurator"
  s.version = "0.1.0"
  s.summary = "Labels photos and scores their quality on the device."
  s.description = "Helps pick a trip's best photos for the replay with Apple Vision (labels, aesthetics) and simple sharpness and exposure checks."
  s.license = { :type => "MIT" }
  s.author = "NomadSafe"
  s.homepage = "https://github.com/expo/expo"
  s.platforms = { :ios => "16.4" }
  s.swift_version = "5.9"
  s.source = { :git => "https://github.com/expo/expo.git" }
  s.static_framework = true
  s.dependency "ExpoModulesCore"
  s.frameworks = "Vision", "ImageIO", "CoreGraphics"
  s.source_files = "ios/**/*.{h,m,mm,swift}"
end
