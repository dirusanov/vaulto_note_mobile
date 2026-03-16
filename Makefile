.PHONY: clean-android build-android-release build-android-bundle rebuild-android rebuild-android-all

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

# Build Android Release AAB
build-android-bundle:
	@echo "Building Android Release Bundle (AAB)..."
	cd android && ./gradlew bundleRelease
	@echo "Bundle build complete."

# Clean and then Build
rebuild-android: clean-android build-android-release

# Clean and then Build APK + AAB
rebuild-android-all: clean-android build-android-release build-android-bundle
