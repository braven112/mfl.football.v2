plugins {
    id("com.android.application")
}

// The page the TV opens. Staging while the board is being iterated on, so a
// push to `staging` reaches the TV without a new app release. Override per
// build with `-PstartUrl=https://...` (the GitHub workflow exposes it).
val startUrl: String = (findProperty("startUrl") as String?)
    ?: "https://staging.mfl.football/theleague/broadcast"

// Upload-key signing comes from the environment (GitHub secrets in CI) so the
// keystore never lives in the repo. Without it, release builds are unsigned
// and only the debug APK is installable.
val keystorePath: String? = System.getenv("MFL_TV_KEYSTORE_PATH")
val hasUploadKey = !keystorePath.isNullOrBlank() && file(keystorePath).exists()

android {
    namespace = "football.mfl.live"
    compileSdk = 36

    defaultConfig {
        applicationId = "football.mfl.live"
        minSdk = 24
        targetSdk = 36
        // CI passes the run number so every upload to Play gets a new code.
        versionCode = (findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (findProperty("versionName") as String?) ?: "1.0.0"
        buildConfigField("String", "START_URL", "\"$startUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (hasUploadKey) {
            create("upload") {
                storeFile = file(keystorePath!!)
                storePassword = System.getenv("MFL_TV_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MFL_TV_KEY_ALIAS")
                keyPassword = System.getenv("MFL_TV_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasUploadKey) signingConfig = signingConfigs.getByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
