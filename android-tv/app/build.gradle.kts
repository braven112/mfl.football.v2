plugins {
    id("com.android.application")
}

// The page the TV opens: production. The app is only a shell, so a site
// release reaches the TV without a new app release. Override per build with
// `-PstartUrl=https://...` (the GitHub workflow exposes it), e.g. to point a
// test build at staging.
//
// `/tv` on the SHARED host, not a league's board: the shared host 404s every
// `/theleague/*` path by design (the league lives at its own apex), and `/tv`
// signs the TV in by QR code from a phone instead of a password typed with the
// remote, then hands off to `/live/broadcast` on its own.
val startUrl: String = (findProperty("startUrl") as String?)
    ?: "https://mfl.football/tv"

// The score overlay's page lives on the same host as the start page, so a test
// build pointed at staging overlays staging too.
// (A regex, not java.net.URI: in this script `java` is the Java extension.)
val overlayUrl: String =
    (Regex("^https?://[^/]+").find(startUrl)?.value ?: "https://mfl.football") + "/live/broadcast/overlay"

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
        buildConfigField("String", "OVERLAY_URL", "\"$overlayUrl\"")
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
