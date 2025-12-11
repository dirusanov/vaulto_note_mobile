.PHONY: clean-android build-android-release rebuild-android

# Clean all Android build artifacts and caches
clean-android:
	@echo "Cleaning Android build artifacts..."
	rm -rf android/.cxx android/app/.cxx android/build android/app/build
	cd android && ./gradlew clean
	@echo "Android clean complete."

# Build Android Release APK
build-android-release:
	@echo "Building Android Release..."
	cd android && ./gradlew assembleRelease
	@echo "Build complete."

# Clean and then Build
rebuild-android: clean-android build-android-release
