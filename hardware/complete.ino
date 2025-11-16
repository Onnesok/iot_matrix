/*
 * AERAS PHASE-01 : User-Side Location Block (ESP32-C3)
 * ----------------------------------------------------
 * - Multi-sensor authentication:
 *     • Ultrasonic presence (≤10 m, ≥3 s)
 *     • Load/touch block matrix pins (destination selection)
 *     • Laser privilege verification via LDR frequency signature
 * - OLED feedback workflow (Idle → Presence → Laser → Confirm → Dispatch)
 * - WiFi + REST integration with the Next.js backend in /src
 * - LED/Buzzer status per competition rubric (Yellow=offer, Red=rejected, Green=ride on the way)
 *
 * Ultrasonic test mapping (scaled demo):
 *   (a) Person at 15 m  (≈30 cm)           → No trigger
 *   (b) Person at 8 m   (≈16 cm) for 2 s   → No trigger
 *   (c) Person at 9 m   (≈18 cm) for 3.5 s → Trigger
 *   (d) Person at 5 m   (≈10 cm) for 5 s   → Trigger
 *   (e) Move 8 m→12 m   (≈16→24 cm) <3 s   → Reset / No trigger
 *
 * Pin reference (ESP32-C3):
 *   I2C SDA  -> GPIO20
 *   I2C SCL  -> GPIO21
 *   Ultrasonic TRIG -> GPIO2
 *   Ultrasonic ECHO -> GPIO3
 *   LDR analog (laser verifier) -> GPIO0 (ADC)
 *   Confirm button -> GPIO7 (active LOW, pull-up enabled)
 *   Buzzer -> GPIO8
 *   LED Yellow -> GPIO4
 *   LED Red    -> GPIO5
 *   LED Green  -> GPIO6
 *   Block sensors:
 *       Pahartoli plate -> GPIO9
 *       Noapara plate   -> GPIO10
 *       Raojan plate    -> GPIO11
 * 
 * Required libraries:
 *   Adafruit_SH110X, Adafruit_GFX, WiFi, HTTPClient, ArduinoJson
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
 #include <Wire.h>
 #include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <math.h>

// ------------ Network + Backend configuration ------------
const char *WIFI_SSID     = "Anime";
const char *WIFI_PASSWORD = "12345678";
const char *API_BASE_URL  = "https://iot-sage-x.vercel.app/api"; // Update to your Next.js deployment

// Users and locations must exist in the seeded backend database
const char *REGISTERED_USER_ID   = "user_block_cuet";
const char *PICKUP_LOCATION_ID   = "loc_1"; // CUET Campus (seeded as block_cuet)

// ------------ Hardware pin map ------------
#define I2C_SDA_PIN   20
#define I2C_SCL_PIN   21

#define ULTRASONIC_TRIG_PIN 2
#define ULTRASONIC_ECHO_PIN 3

#define LDR_PIN              0   // ADC pin

#define CONFIRM_BUTTON_PIN   7   // Physical confirm/buzzer combo
#define BUZZER_PIN           8

#define LED_YELLOW_PIN       4
#define LED_RED_PIN          5
#define LED_GREEN_PIN        6

// Destination matrix sensors (one GPIO per pile block plate)
struct DestinationBlock {
  const char *blockId;
  const char *destinationLocationId;
  const char *label;
  uint8_t sensorPin;
};

DestinationBlock DESTINATION_BLOCKS[] = {
  {"block_pahartoli", "loc_2", "Pahartoli", 9},
  {"block_noapara",   "loc_3", "Noapara",   10},
  {"block_raojan",    "loc_4", "Raojan",    11}
};
const size_t DESTINATION_COUNT = sizeof(DESTINATION_BLOCKS) / sizeof(DESTINATION_BLOCKS[0]);

// ------------ Sensor tuning ------------
// NOTE: The real brief uses 0–10 m. For bench demos we scale it down so 1 m ≈ 2 cm.
// Examples:
//   - 5 m  ≈ 10 cm
//   - 8 m  ≈ 16 cm
//   - 9 m  ≈ 18 cm
//   - 15 m ≈ 30 cm (treated as “too far / no trigger” sample)
const float  REAL_TO_DEMO_SCALE_CM_PER_M     = 2.0f;    // scaling factor mentioned above
const float  REAL_RANGE_MAX_M                = 10.0f;   // spec requirement
const float  MAX_DISTANCE_CM                 = REAL_RANGE_MAX_M * REAL_TO_DEMO_SCALE_CM_PER_M; // 20 cm demo range (10 m real)
const float  DISTANCE_MARGIN_CM              = 3.0f;    // ±3 cm (~±3 m real) tolerance band
const float  MAX_DISTANCE_WITH_MARGIN_CM     = MAX_DISTANCE_CM + DISTANCE_MARGIN_CM;
const float  OUT_OF_RANGE_CM                 = 15.0f * REAL_TO_DEMO_SCALE_CM_PER_M; // 30 cm ≈ 15 m example (no trigger)
const unsigned long HOLD_TIME_FAR_MS         = 3500;    // 9 m case (~18 cm) requires 3.5 s
const unsigned long HOLD_TIME_NEAR_MS        = 5000;    // 5 m case (~10 cm) requires 5 s
const unsigned long BLOCK_SELECT_HOLD_MS     = 600;     // ms block plate must stay active
const unsigned long BUTTON_LOCKOUT_MS        = 2000;    // ignore duplicate presses
const unsigned long BUTTON_HOLD_TIMEOUT_MS   = 5000;    // >5s press cancels flow
const uint8_t        PRESENCE_STABLE_SAMPLES = 4;       // require N consecutive readings in range
const float          DISTANCE_TOLERANCE_CM   = 3.0f;    // ±3 cm stability requirement
const uint8_t        ULTRASONIC_SAMPLE_COUNT = 5;       // samples per measurement

int ambientLdrBaseline = 0;

const int    LDR_REFERENCE_DELTA      = 1800;    // expected ADC delta when laser fully on
const float  LDR_PERCENT_THRESHOLD_HIGH = 12.0f; // % above baseline required to start hold
const float  LDR_PERCENT_THRESHOLD_LOW  = 8.0f;  // hysteresis release threshold
const unsigned long LDR_HOLD_DURATION_MS = 4200; // hold time once threshold met
const unsigned long LDR_TRIGGER_STABILITY_MS = 250; // time above threshold before countdown
const int    LDR_MIN_ABS_DELTA        = 45;     // minimum raw ADC delta to consider valid
const float  LDR_PERCENT_SMOOTH_ALPHA = 0.06f;   // smoothing factor for percent display
const int    LDR_ADC_CONTINUE_DELTA   = 18;      // keep filling if raw delta above this

const unsigned long BUTTON_DEBOUNCE_MS    = 45;
const unsigned long STATUS_POLL_INTERVAL  = 2000;
const unsigned long REQUEST_TIMEOUT_MS    = 60000;

// ------------ Display ------------
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SH1106G display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ------------ State machine ------------
enum SystemState {
  STATE_IDLE,
  STATE_PRESENCE_TRACKING,
  STATE_WAITING_BLOCK,
  STATE_WAITING_LASER_READY,
  STATE_WAITING_LASER,
  STATE_WAITING_CONFIRM,
  STATE_DISPATCHING,
  STATE_WAITING_PULLER,
  STATE_RIDE_ACCEPTED,
  STATE_PICKUP_CONFIRMED,
  STATE_RIDE_COMPLETED,
  STATE_REJECTED_OR_ERROR
};

SystemState currentState = STATE_IDLE;
unsigned long stateStartedAt = 0;
unsigned long lastStatusPollAt = 0;
unsigned long requestIssuedAt = 0;
unsigned long presenceProgressMs = 0;
unsigned long lastPresenceSampleAt = 0;
unsigned long laserStateEnteredAt = 0;
uint8_t consecutiveInRangeSamples = 0;

String activeRideId = "";
int latchedBlockIndex = -1;
bool laserVerified = false;
int candidateBlockIndex = -1;
unsigned long blockSelectStartedAt = 0;
unsigned long lastButtonAcceptedAt = 0;
unsigned long buttonPressStartAt = 0;
bool buttonHoldTimeoutTriggered = false;
String lastPickupName = "";
String lastDestinationName = "";
float lastStableDistanceCm = -1.0f;
unsigned long confirmPresenceLostStartedAt = 0;

bool laserPercentInitialized = false;
float currentLaserPercent = 0.0f;
float smoothedLaserPercent = 0.0f;
unsigned long currentLaserHoldMs = 0;
unsigned long currentLaserTargetMs = LDR_HOLD_DURATION_MS;
unsigned long laserHoldStartedAt = 0;
bool laserHoldActive = false;
int lastLdrReading = 0;
bool laserAboveHysteresis = false;
int lastLdrDelta = 0;
unsigned long laserThresholdSatisfiedAt = 0;

// ------------ Forward declarations ------------
void connectWiFiBlocking();
void ensureWiFi();
void scanI2CBus();
void drawSplash();
void drawInstruction(const char *title, const String &line2 = "", const String &line3 = "", const String &line4 = "");
void showUltrasonicStatus(float distanceCm, unsigned long holdMs, bool stable, unsigned long targetHoldMs);
void showLaserStatus(bool verified);
unsigned long requiredHoldDurationMs(float distanceCm);
void updateStateMachine(float distanceCm, bool distanceStable, int activeBlock, int ldrAdc);
float readUltrasonicDistanceCm();
int detectActiveBlock();
bool isWithinPresenceRange(float distanceCm);
void resetPresenceTracking();
bool updateDistanceStability(float distanceCm);
bool detectLaserSignature(int ldrAdc);
float computeLaserPercent(int ldrAdc);
void resetLaserTracking();
void recalibrateLdrBaseline(uint8_t samples = 30, uint16_t delayMs = 5);
bool confirmButtonPressed();
void sendRideRequest();
void pollRideStatus();
void updateIndicators();
void resetSystem(const char *reason);
void playTonePattern(uint16_t highMs, uint8_t repeats);
void setState(SystemState nextState);
void setLEDs(bool yellow, bool red, bool green);

// ===================================================================
 void setup() {
   Serial.begin(115200);
  delay(200);
  Serial.println("\n=== AERAS User-Side Block Boot ===");
   
  pinMode(ULTRASONIC_TRIG_PIN, OUTPUT);
  pinMode(ULTRASONIC_ECHO_PIN, INPUT);
  pinMode(LDR_PIN, INPUT);

  pinMode(CONFIRM_BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);

  pinMode(LED_YELLOW_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  setLEDs(false, false, false);

  for (size_t i = 0; i < DESTINATION_COUNT; i++) {
    pinMode(DESTINATION_BLOCKS[i].sensorPin, INPUT_PULLDOWN);
  }

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  delay(100);
  scanI2CBus();

  if (!display.begin(0x3C, true)) {
    Serial.println("FATAL: SH1106 init failed");
    while (true) {
      digitalWrite(LED_RED_PIN, !digitalRead(LED_RED_PIN));
      delay(250);
    }
  }

  drawSplash();
  playTonePattern(150, 2);

  connectWiFiBlocking();

  // Calibrate LDR baseline
  recalibrateLdrBaseline(50, 6);

  drawInstruction("Stand on a block", "Hold for 3 sec", "Laser after prompt", "Then press confirm");
  currentState = STATE_IDLE;
  stateStartedAt = millis();
}

// ===================================================================
void loop() {
  ensureWiFi();

  float distanceCm = readUltrasonicDistanceCm();
  int activeBlock = detectActiveBlock();
  int ldrReading = analogRead(LDR_PIN);
  lastLdrReading = ldrReading;
  lastLdrDelta = max(0, ldrReading - ambientLdrBaseline);
  bool distanceStable = updateDistanceStability(distanceCm);

  updateStateMachine(distanceCm, distanceStable, activeBlock, ldrReading);
  updateIndicators();

  delay(35);
}

// ===================================================================
void updateStateMachine(float distanceCm, bool distanceStable, int activeBlock, int ldrAdc) {
  switch (currentState) {
    case STATE_IDLE: {
      unsigned long targetHold = requiredHoldDurationMs(distanceCm);
      showUltrasonicStatus(distanceCm, 0, false, targetHold);
      if (isWithinPresenceRange(distanceCm) && distanceStable) {
        latchedBlockIndex = -1;
        resetPresenceTracking();
        lastPresenceSampleAt = millis();
        setState(STATE_PRESENCE_TRACKING);
      }
      break;
    }

    case STATE_PRESENCE_TRACKING: {
      unsigned long targetHold = requiredHoldDurationMs(distanceCm);
      if (!isWithinPresenceRange(distanceCm)) {
        resetPresenceTracking();
        setState(STATE_IDLE);
        showUltrasonicStatus(distanceCm, 0, false, targetHold);
        break;
      }
      if (!distanceStable) {
        // stay in tracking but do not accumulate
        showUltrasonicStatus(distanceCm, 0, false, targetHold);
        lastPresenceSampleAt = millis();
        presenceProgressMs = 0;
        break;
      }

      unsigned long now = millis();
      if (lastPresenceSampleAt == 0) {
        lastPresenceSampleAt = now;
      }
      unsigned long delta = now - lastPresenceSampleAt;
      if (presenceProgressMs + delta > targetHold) {
        presenceProgressMs = targetHold;
      } else {
        presenceProgressMs += delta;
      }
      lastPresenceSampleAt = now;

      showUltrasonicStatus(distanceCm, presenceProgressMs, true, targetHold);

      if (presenceProgressMs >= targetHold) {
        candidateBlockIndex = -1;
        blockSelectStartedAt = 0;
        setState(STATE_WAITING_BLOCK);
        drawInstruction("Presence confirmed",
                        "Step on destination block",
                        "Stay within range",
                        "Hold block for 0.6s");
      }
      break;
    }

    case STATE_WAITING_BLOCK: {
      if (!distanceStable) {
        resetSystem("Presence lost");
        break;
      }

      int detected = detectActiveBlock();
      if (detected < 0) {
        candidateBlockIndex = -1;
        blockSelectStartedAt = 0;
        drawInstruction("Select destination",
                        "Step on a location plate",
                        "Stay within 10 m",
                        "");
        break;
      }

      if (candidateBlockIndex != detected) {
        candidateBlockIndex = detected;
        blockSelectStartedAt = millis();
        drawInstruction("Confirm block",
                        DESTINATION_BLOCKS[detected].label,
                        "Hold for 0.6s",
                        "");
      } else if (millis() - blockSelectStartedAt >= BLOCK_SELECT_HOLD_MS) {
        latchedBlockIndex = candidateBlockIndex;
        setState(STATE_WAITING_LASER);
        showLaserStatus(false);
        laserStateEnteredAt = millis();
      }
      break;
    }

    case STATE_WAITING_LASER: {
      if (activeBlock >= 0 && activeBlock != latchedBlockIndex) {
        resetSystem("Block changed");
        break;
      }

      bool verified = detectLaserSignature(ldrAdc);
      showLaserStatus(verified);
      if (verified) {
        laserVerified = true;
        playTonePattern(120, 2);
        setState(STATE_WAITING_CONFIRM);
        drawInstruction("Privilege OK",
                        "Block: " + String(DESTINATION_BLOCKS[latchedBlockIndex].label),
                        "Press confirm button",
                        "or step away to cancel");
      }
      break;
    }

    case STATE_WAITING_CONFIRM: {
      if (!isWithinPresenceRange(distanceCm)) {
        if (confirmPresenceLostStartedAt == 0) {
          confirmPresenceLostStartedAt = millis();
        } else if (millis() - confirmPresenceLostStartedAt > 2000) {
          resetSystem("Presence lost");
          break;
        }
      } else {
        confirmPresenceLostStartedAt = 0;
      }
      if (activeBlock >= 0 && activeBlock != latchedBlockIndex) {
        candidateBlockIndex = activeBlock;
        blockSelectStartedAt = millis();
        setState(STATE_WAITING_BLOCK);
        drawInstruction("Destination changed",
                        "Block: " + String(DESTINATION_BLOCKS[activeBlock].label),
                        "Hold for 0.6s",
                        "");
        break;
      }

      if (buttonHoldTimeoutTriggered) {
        resetSystem("Button held too long");
        playTonePattern(200, 2);
        buttonHoldTimeoutTriggered = false;
        break;
      }

      if (confirmButtonPressed()) {
        unsigned long now = millis();
        if (now - lastButtonAcceptedAt < BUTTON_LOCKOUT_MS) {
          // ignore duplicate
          break;
        }
        lastButtonAcceptedAt = now;

        setState(STATE_DISPATCHING);
        drawInstruction("Sending request...",
                        DESTINATION_BLOCKS[latchedBlockIndex].label,
                        "WiFi: " + String(WiFi.localIP().toString().c_str()),
                        "");
        sendRideRequest();
      }
      break;
    }

    case STATE_DISPATCHING:
      // Busy while HTTP POST is running
      break;

    case STATE_WAITING_PULLER: {
      unsigned long now = millis();
      if (activeRideId.length() == 0) {
        resetSystem("Ride ID missing");
        break;
      }

      if (now - requestIssuedAt >= REQUEST_TIMEOUT_MS) {
        setState(STATE_REJECTED_OR_ERROR);
        drawInstruction("Timeout",
                        "No puller responded",
                        "Red LED shows error",
                        "Please retry");
        break;
      }

      if (now - lastStatusPollAt >= STATUS_POLL_INTERVAL) {
        pollRideStatus();
      }
      break;
    }

    case STATE_RIDE_ACCEPTED:
    case STATE_PICKUP_CONFIRMED: {
      if (activeRideId.length() == 0) {
        resetSystem("Ride ID missing");
        break;
      }
      if (millis() - lastStatusPollAt >= STATUS_POLL_INTERVAL) {
        pollRideStatus();
      }
      break;
    }

    case STATE_RIDE_COMPLETED:
      if (millis() - stateStartedAt > 8000) {
        resetSystem("Ride cycle complete");
      }
      break;

    case STATE_REJECTED_OR_ERROR:
      if (millis() - stateStartedAt > 8000) {
        resetSystem("Request ended");
      }
      break;
   }
}

// ===================================================================
float readUltrasonicDistanceCm() {
  float sum = 0.0f;
  uint8_t validSamples = 0;

  for (uint8_t i = 0; i < ULTRASONIC_SAMPLE_COUNT; i++) {
    digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(ULTRASONIC_TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(ULTRASONIC_TRIG_PIN, LOW);

    long duration = pulseIn(ULTRASONIC_ECHO_PIN, HIGH, 35000);
    if (duration > 0) {
      float cm = (duration * 0.0343f) / 2.0f;
      if (cm > 0 && cm <= (OUT_OF_RANGE_CM + 10.0f)) {
        sum += cm;
        validSamples++;
      }
    }
    delay(3);
   }
   
  if (validSamples == 0) {
    return -1.0f;
  }
  return sum / validSamples;
}

// ===================================================================
int detectActiveBlock() {
  for (size_t i = 0; i < DESTINATION_COUNT; i++) {
    if (digitalRead(DESTINATION_BLOCKS[i].sensorPin) == HIGH) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

bool isWithinPresenceRange(float distanceCm) {
  return distanceCm > 0 && distanceCm <= MAX_DISTANCE_WITH_MARGIN_CM;
}

void resetPresenceTracking() {
  presenceProgressMs = 0;
  lastPresenceSampleAt = 0;
  candidateBlockIndex = -1;
  blockSelectStartedAt = 0;
  consecutiveInRangeSamples = 0;
  lastStableDistanceCm = -1.0f;
}

bool updateDistanceStability(float distanceCm) {
  if (!isWithinPresenceRange(distanceCm)) {
    consecutiveInRangeSamples = 0;
    lastStableDistanceCm = -1.0f;
    return false;
  }

  if (lastStableDistanceCm < 0 || fabs(distanceCm - lastStableDistanceCm) <= DISTANCE_TOLERANCE_CM) {
    if (consecutiveInRangeSamples < PRESENCE_STABLE_SAMPLES) {
      consecutiveInRangeSamples++;
    }
    lastStableDistanceCm = (lastStableDistanceCm < 0) ? distanceCm : ((lastStableDistanceCm * 0.7f) + (distanceCm * 0.3f));
   } else {
    // distance jumped more than tolerance, restart stability counter
    consecutiveInRangeSamples = 1;
    lastStableDistanceCm = distanceCm;
  }

  return consecutiveInRangeSamples >= PRESENCE_STABLE_SAMPLES;
   }
   
// ===================================================================
float computeLaserPercent(int ldrAdc) {
  int delta = max(0, ldrAdc - ambientLdrBaseline);
  float instantPercent = (delta * 100.0f) / (float)LDR_REFERENCE_DELTA;
  if (instantPercent < 0.0f) instantPercent = 0.0f;
  if (instantPercent > 120.0f) instantPercent = 120.0f;

  if (!laserPercentInitialized) {
    smoothedLaserPercent = instantPercent;
    laserPercentInitialized = true;
  } else {
    smoothedLaserPercent =
        (smoothedLaserPercent * (1.0f - LDR_PERCENT_SMOOTH_ALPHA)) +
        (instantPercent * LDR_PERCENT_SMOOTH_ALPHA);
  }

  currentLaserPercent = smoothedLaserPercent;
  return currentLaserPercent;
}

void resetLaserTracking() {
  laserPercentInitialized = false;
  currentLaserPercent = 0.0f;
  smoothedLaserPercent = 0.0f;
  currentLaserHoldMs = 0;
  currentLaserTargetMs = LDR_HOLD_DURATION_MS;
  laserHoldStartedAt = 0;
  laserHoldActive = false;
  laserAboveHysteresis = false;
  laserThresholdSatisfiedAt = 0;
}

void recalibrateLdrBaseline(uint8_t samples, uint16_t delayMs) {
  if (samples == 0) return;
  long sum = 0;
  for (uint8_t i = 0; i < samples; i++) {
    sum += analogRead(LDR_PIN);
    delay(delayMs);
  }
  ambientLdrBaseline = sum / samples;
  Serial.printf("LDR baseline recalibrated: %d\n", ambientLdrBaseline);
}

bool detectLaserSignature(int ldrAdc) {
  unsigned long now = millis();
  float percent = computeLaserPercent(ldrAdc);

  if (!laserAboveHysteresis && percent >= LDR_PERCENT_THRESHOLD_HIGH) {
    laserAboveHysteresis = true;
  } else if (laserAboveHysteresis && percent <= LDR_PERCENT_THRESHOLD_LOW) {
    laserAboveHysteresis = false;
  }

  bool aboveThreshold = (lastLdrDelta >= LDR_MIN_ABS_DELTA) ||
                        (laserAboveHysteresis && lastLdrDelta >= LDR_ADC_CONTINUE_DELTA);

  currentLaserTargetMs = LDR_HOLD_DURATION_MS;

  if (aboveThreshold) {
    if (laserThresholdSatisfiedAt == 0) {
      laserThresholdSatisfiedAt = now;
    }

    if (!laserHoldActive) {
    unsigned long stableDuration = now - laserThresholdSatisfiedAt;
    if (stableDuration >= LDR_TRIGGER_STABILITY_MS) {
      laserHoldActive = true;
      laserHoldStartedAt = now;
      currentLaserHoldMs = 0;
    }
    }

    if (laserHoldActive) {
      currentLaserHoldMs = now - laserHoldStartedAt;
      if (currentLaserHoldMs > currentLaserTargetMs) {
        currentLaserHoldMs = currentLaserTargetMs;
      }
      if (currentLaserHoldMs >= currentLaserTargetMs) {
        return true;
      }
    }
  } else {
    bool keepFilling = laserHoldActive && lastLdrDelta >= LDR_ADC_CONTINUE_DELTA;
    if (keepFilling) {
      if (laserHoldStartedAt == 0) {
        laserHoldStartedAt = now - currentLaserHoldMs;
      }
      currentLaserHoldMs = now - laserHoldStartedAt;
      if (currentLaserHoldMs > currentLaserTargetMs) {
        currentLaserHoldMs = currentLaserTargetMs;
      }
      if (currentLaserHoldMs >= currentLaserTargetMs) {
        return true;
      }
    } else {
      laserThresholdSatisfiedAt = 0;
      laserHoldActive = false;
      laserHoldStartedAt = 0;
      currentLaserHoldMs = 0;
    }
  }

  Serial.printf("LDR pct=%.1f d=%d hold=%lu/%lu stab=%lu/%lu ADC=%d base=%d thr=%.1f/%.1f hyst=%d keep=%s\n",
                percent,
                lastLdrDelta,
                currentLaserHoldMs,
                currentLaserTargetMs,
                laserThresholdSatisfiedAt ? (now - laserThresholdSatisfiedAt) : 0,
                LDR_TRIGGER_STABILITY_MS,
                lastLdrReading,
                ambientLdrBaseline,
                LDR_PERCENT_THRESHOLD_HIGH,
                LDR_PERCENT_THRESHOLD_LOW,
                laserAboveHysteresis,
                (laserHoldActive && lastLdrDelta > LDR_ADC_CONTINUE_DELTA) ? "yes" : "no");

  return false;
}

// ===================================================================
bool confirmButtonPressed() {
  static bool lastStableState = false;
  static unsigned long lastChange = 0;

  bool rawState = digitalRead(CONFIRM_BUTTON_PIN) == LOW; // Active LOW

  if (rawState && buttonPressStartAt == 0) {
    buttonPressStartAt = millis();
  }
  if (rawState && buttonPressStartAt > 0 &&
      millis() - buttonPressStartAt > BUTTON_HOLD_TIMEOUT_MS) {
    buttonHoldTimeoutTriggered = true;
  }

  if (rawState != lastStableState && millis() - lastChange > BUTTON_DEBOUNCE_MS) {
    lastChange = millis();
    lastStableState = rawState;
    if (!rawState) { // button released
      unsigned long pressDuration = buttonPressStartAt > 0 ? millis() - buttonPressStartAt : 0;
      buttonPressStartAt = 0;
      if (pressDuration >= BUTTON_HOLD_TIMEOUT_MS) {
        buttonHoldTimeoutTriggered = true;
        return false;
     }
      playTonePattern(80, 1);
      return true;
    }
  }
  return false;
}

// ===================================================================
void sendRideRequest() {
  if (latchedBlockIndex < 0) {
    resetSystem("No destination");
    return;
  }

  ensureWiFi();
  HTTPClient http;
  String url = String(API_BASE_URL) + "/rides";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> body;
  body["userId"] = REGISTERED_USER_ID;
  body["pickupLocationId"] = PICKUP_LOCATION_ID;
  body["destinationLocationId"] = DESTINATION_BLOCKS[latchedBlockIndex].destinationLocationId;

  String payload;
  serializeJson(body, payload);

  int code = http.POST(payload);
  if (code == 201) {
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, http.getString());
    if (!err && doc.containsKey("ride")) {
      activeRideId = doc["ride"]["id"].as<String>();
      lastPickupName = String(doc["ride"]["pickupLocation"]["name"] | "Pickup");
      lastDestinationName = String(doc["ride"]["destinationLocation"]["name"] | "Destination");
      requestIssuedAt = millis();
      lastStatusPollAt = 0;
      setState(STATE_WAITING_PULLER);
      drawInstruction("Request sent",
                      "Pickup: " + lastPickupName,
                      "Destination: " + lastDestinationName,
                      "Waiting for puller...");
      Serial.println("Ride created: " + activeRideId);
    } else {
      Serial.println("JSON parse error on POST /rides");
      setState(STATE_REJECTED_OR_ERROR);
      drawInstruction("Invalid response",
                      "Could not parse ride",
                      "Check backend payload",
                      "");
    }
  } else {
    Serial.printf("Ride POST failed: %d\n", code);
    setState(STATE_REJECTED_OR_ERROR);
    drawInstruction("Request failed",
                    "HTTP " + String(code),
                    http.errorToString(code),
                    "Red LED = error");
 }
  http.end();
}

// ===================================================================
void pollRideStatus() {
  if (activeRideId.isEmpty()) {
    return;
  }
  ensureWiFi();

  HTTPClient http;
  String url = String(API_BASE_URL) + "/rides/" + activeRideId;
  http.begin(url);

  int code = http.GET();
  if (code == 200) {
    StaticJsonDocument<768> doc;
    DeserializationError err = deserializeJson(doc, http.getString());
    if (err) {
      Serial.println("Failed to parse ride status JSON");
      http.end();
      return;
    }

    lastStatusPollAt = millis();
    const char *status = doc["ride"]["status"] | "pending";
    Serial.printf("Ride %s status: %s\n", activeRideId.c_str(), status);

    if (strcmp(status, "accepted") == 0) {
      setState(STATE_RIDE_ACCEPTED);
      drawInstruction("Puller accepted",
                      "Pickup: " + lastPickupName,
                      "Destination: " + lastDestinationName,
                      "Yellow LED = en route");
    } else if (strcmp(status, "pickup_confirmed") == 0 || strcmp(status, "in_progress") == 0) {
      setState(STATE_PICKUP_CONFIRMED);
      drawInstruction("Pickup confirmed",
                      "Ride in progress",
                      "Green LED steady",
                      "");
    } else if (strcmp(status, "completed") == 0) {
      setState(STATE_RIDE_COMPLETED);
      drawInstruction("Ride completed",
                      "Thank you!",
                      "System resetting soon",
                      "");
    } else if (strcmp(status, "rejected") == 0 || strcmp(status, "cancelled") == 0) {
      setState(STATE_REJECTED_OR_ERROR);
      drawInstruction("Ride rejected",
                      "Please try again",
                      "Red LED steady",
                      "");
    } else {
      // still pending, nothing extra
    }
  } else if (code == 404) {
    setState(STATE_REJECTED_OR_ERROR);
    drawInstruction("Ride missing",
                    "Backend returned 404",
                    "Resetting soon",
                    "");
  } else {
    Serial.printf("GET ride failed: %d\n", code);
  }

  http.end();
}

// ===================================================================
void resetSystem(const char *reason) {
  Serial.println(String("Resetting state: ") + reason);
  activeRideId = "";
  latchedBlockIndex = -1;
  resetPresenceTracking();
  laserVerified = false;
  laserStateEnteredAt = 0;
  buttonHoldTimeoutTriggered = false;
  buttonPressStartAt = 0;
  lastButtonAcceptedAt = 0;
  resetLaserTracking();
  setLEDs(false, false, false);
  drawInstruction("AERAS Ready",
                  "Step on destination block",
                  "Hold for ≥3 sec",
                  "Reason: " + String(reason));
  setState(STATE_IDLE);
}

// ===================================================================
void setState(SystemState nextState) {
  currentState = nextState;
  stateStartedAt = millis();
  if (nextState == STATE_WAITING_LASER) {
    recalibrateLdrBaseline(24, 4);
    laserStateEnteredAt = stateStartedAt;
    resetLaserTracking();
   }
  if (nextState == STATE_WAITING_CONFIRM) {
    buttonHoldTimeoutTriggered = false;
    buttonPressStartAt = 0;
    confirmPresenceLostStartedAt = 0;
  }
}

// ===================================================================
void updateIndicators() {
   static unsigned long lastBlink = 0;
  static bool blinkState = false;

  unsigned long now = millis();
  if (now - lastBlink > 500) {
    lastBlink = now;
    blinkState = !blinkState;
  }

  switch (currentState) {
    case STATE_WAITING_PULLER:
      setLEDs(blinkState, false, false); // Yellow blink while alerting community
      break;
    case STATE_RIDE_ACCEPTED:
      setLEDs(true, false, false); // Yellow solid = offer locked in
      break;
    case STATE_PICKUP_CONFIRMED:
    case STATE_RIDE_COMPLETED:
      setLEDs(false, false, true); // Green = ride active/success
      break;
    case STATE_REJECTED_OR_ERROR:
      setLEDs(false, true, false); // Red = rejection or timeout
      break;
    default:
      setLEDs(false, false, false);
      break;
  }
}

// ===================================================================
void setLEDs(bool yellow, bool red, bool green) {
  digitalWrite(LED_YELLOW_PIN, yellow ? HIGH : LOW);
  digitalWrite(LED_RED_PIN, red ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, green ? HIGH : LOW);
}

// ===================================================================
void playTonePattern(uint16_t highMs, uint8_t repeats) {
  for (uint8_t i = 0; i < repeats; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(highMs);
    digitalWrite(BUZZER_PIN, LOW);
    delay(60);
  }
}

// ===================================================================
void drawInstruction(const char *title, const String &line2, const String &line3, const String &line4) {
  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.println("AERAS | User Block");
  display.drawLine(0, 10, SCREEN_WIDTH, 10, SH110X_WHITE);

  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println(title);
  display.println();
  if (line2.length()) display.println(line2);
  if (line3.length()) display.println(line3);
  if (line4.length()) display.println(line4);
  display.display();
 }
 
// ===================================================================
void drawSplash() {
  display.clearDisplay();
  display.setTextSize(3);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(12, 20);
  display.println("AERAS");
  display.display();
  delay(1500);
}

void showUltrasonicStatus(float distanceCm, unsigned long holdMs, bool stable, unsigned long targetHoldMs) {
   display.clearDisplay();
   display.setTextColor(SH110X_WHITE);
 
  // Distance label
   display.setTextSize(1);
   display.setCursor(0, 0);
  display.print("DISTANCE  (<= ");
  display.print(MAX_DISTANCE_CM, 0);
  display.println("cm)");

  display.setTextSize(3);
  display.setCursor(0, 12);
  if (distanceCm > 0) {
    display.print(distanceCm, 0);
    display.println("cm");
   } else {
    display.println("--cm");
   }
 
  // Hold timer
   display.setTextSize(1);
  display.setCursor(0, 42);
  display.print("HOLD ");
  display.print(holdMs / 1000.0f, 1);
  display.print("/");
  display.print(targetHoldMs / 1000.0f, 1);
  display.print("s  tol:");
  display.print(DISTANCE_TOLERANCE_CM, 0);
  display.print("cm");

  // Progress bar
  display.drawRect(0, 54, 118, 8, SH110X_WHITE);
  if (stable && targetHoldMs > 0) {
    int width = (int)(min(1.0f, holdMs / (float)targetHoldMs) * 116);
    display.fillRect(1, 55, width, 6, SH110X_WHITE);
   }
 
   display.display();
 }
 
void showLaserStatus(bool verified) {
  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("LASER VERIFICATION");

  display.setCursor(0, 14);
  display.setTextSize(2);
  display.print((int)round(currentLaserPercent));
  display.println("%");

  display.setTextSize(1);
  display.setCursor(0, 34);
  if (verified) {
    display.println("Privilege confirmed");
  } else if (laserHoldActive) {
    display.println("Hold steady...");
  } else if (laserThresholdSatisfiedAt) {
    display.println("Beam stabilizing...");
  } else {
    display.println("Aim light >8%");
  }

  display.setCursor(0, 44);
  display.print("ADC ");
  display.print(lastLdrReading);
  display.print(" ∆");
  display.print(lastLdrDelta);

  display.setCursor(0, 54);
  display.print("HOLD ");
  if (currentLaserTargetMs > 0) {
    display.print(currentLaserHoldMs / 1000.0f, 1);
    display.print("/");
    display.print(currentLaserTargetMs / 1000.0f, 1);
    display.println("s");
  } else {
    display.println("--/-- s");
  }

  display.drawRect(0, 60, 118, 4, SH110X_WHITE);
  if ((laserHoldActive || verified) && currentLaserTargetMs > 0) {
    float progress = min(1.0f, currentLaserHoldMs / (float)currentLaserTargetMs);
    int width = (int)(progress * 116);
    display.fillRect(1, 61, width, 2, SH110X_WHITE);
  } else if (laserThresholdSatisfiedAt && LDR_TRIGGER_STABILITY_MS > 0) {
    unsigned long preHold = min((unsigned long)(millis() - laserThresholdSatisfiedAt), LDR_TRIGGER_STABILITY_MS);
    float progress = min(1.0f, preHold / (float)LDR_TRIGGER_STABILITY_MS);
    int width = (int)(progress * 116);
    display.drawLine(1, 62, 1 + width, 62, SH110X_WHITE);
  }

  display.display();
}

// ===================================================================
unsigned long requiredHoldDurationMs(float distanceCm) {
  if (distanceCm > 0 && distanceCm <= 10.5f) {
    return HOLD_TIME_NEAR_MS;
  }
  return HOLD_TIME_FAR_MS;
}

void connectWiFiBlocking() {
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
    if (millis() - start > 15000) {
      Serial.println("\nRetrying WiFi...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      start = millis();
    }
  }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
}

// ===================================================================
void ensureWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFiBlocking();
  }
}

// ===================================================================
void scanI2CBus() {
  Serial.println("Scanning I2C bus...");
  for (uint8_t address = 1; address < 0x7F; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("I2C device found at 0x%02X\n", address);
    }
  }
 }
 