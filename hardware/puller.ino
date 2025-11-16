/*
 * AERAS - Rickshaw Request Viewer with Hardware Accept/Reject
 * Board: ESP32
 * Display: SSD1306 128x64 I2C OLED (addr 0x3C)
 *
 * Features:
 *  - Polls backend for pending/active ride requests
 *  - Shows latest request on OLED
 *  - Two buttons:
 *      - Accept button: PATCH /api/rides/[id] { action: "accept", pullerId: "<id/phone>" }
 *      - Reject button: PATCH /api/rides/[id] { action: "reject" }
 */

 #include <WiFi.h>
 #include <HTTPClient.h>
 #include <ArduinoJson.h>
 #include <Wire.h>
 #include <Adafruit_GFX.h>
 #include <Adafruit_SSD1306.h>
 
 // ================== USER CONFIG ==================
 
 // WiFi credentials
 const char* WIFI_SSID     = "Anime";
 const char* WIFI_PASSWORD = "12345678";
 
 // Base URL of your backend (no trailing slash)
 // Example: "http://192.168.0.10:3000"
 const char* BACKEND_BASE_URL = "https://iot-sage-x.vercel.app/api";
 
 // Puller identifier (can be phone or puller id – must match backend logic)
 const char* PULLER_ID = "puller_123";  // change per rickshaw
 
// Button pins (active LOW with internal pull‑ups) for XIAO ESP32-C3
// Wire your buttons to these GPIOs (other side to GND)
const int BUTTON_ACCEPT_PIN = 2;
const int BUTTON_REJECT_PIN = 3;
 
 // Poll interval (ms)
 const unsigned long POLL_INTERVAL_MS = 3000;
 
// ================== OLED SETUP ===================

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1

// XIAO ESP32-C3 I2C pins (same as used in hello_world_oled.ino)
#define I2C_SDA 20
#define I2C_SCL 21

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
 
 // ================== STATE ========================
 
 String currentRideId = "";
 String currentPickupName = "";
 String currentDestName = "";
 String currentStatus = "";
 bool   hasRequest = false;
 
 unsigned long lastPoll = 0;
 
 // Simple debounce
 unsigned long lastButtonCheck = 0;
 const unsigned long BUTTON_DEBOUNCE_MS = 150;
 int lastAcceptState = HIGH;
 int lastRejectState = HIGH;
 
 // ================== HELPERS ======================
 
 void showSplash(const char* line2) {
   display.clearDisplay();
   display.setTextSize(1);
   display.setTextColor(SSD1306_WHITE);
   display.setCursor(0, 0);
   display.println(F("AERAS Rickshaw"));
   display.println(line2);
   display.display();
 }
 
 void showNoRequest() {
   hasRequest = false;
   display.clearDisplay();
   display.setTextSize(1);
   display.setTextColor(SSD1306_WHITE);
   display.setCursor(0, 0);
   display.println(F("AERAS Rickshaw"));
   display.println("Puller: " + String(PULLER_ID));
   display.println("");
   display.println(F("No pending requests"));
   display.println(F("Waiting..."));
   display.display();
 }
 
 void showCurrentRequest() {
   display.clearDisplay();
   display.setTextSize(1);
   display.setTextColor(SSD1306_WHITE);
   display.setCursor(0, 0);
   display.println(F("INCOMING REQUEST"));
   display.println(F("----------------"));
 
   display.println("From: " + currentPickupName);
   display.println("To:   " + currentDestName);
   display.println("Sts:  " + currentStatus);
   display.println("");
   display.println("A:Accept  B:Reject"); // button labels
 
   display.display();
 }
 
 // ================== NETWORK ACTIONS ==============
 
void setPullerOnline(bool online) {
  HTTPClient http;
  // BACKEND_BASE_URL already includes /api, so we omit it here
  String url = String(BACKEND_BASE_URL) + "/pullers/" + PULLER_ID;
  http.begin(url);
   http.addHeader("Content-Type", "application/json");
 
   StaticJsonDocument<128> doc;
   doc["isOnline"] = online;
   String body;
   serializeJson(doc, body);
 
   int code = http.PATCH(body);
   Serial.printf("setPullerOnline(%d) -> %d\n", online, code);
   http.end();
 }
 
 // Poll /api/rides?type=active and pick the first pending/available ride
 void pollRequests() {
  HTTPClient http;
 // BACKEND_BASE_URL already includes /api, so we omit it here
 String url = String(BACKEND_BASE_URL) + "/rides?type=active";
  http.begin(url);
 
   int httpCode = http.GET();
   if (httpCode != 200) {
     Serial.printf("GET %s -> %d\n", url.c_str(), httpCode);
     http.end();
     return;
   }
 
   String payload = http.getString();
   http.end();
   Serial.println("Active rides payload:");
   Serial.println(payload);
 
   StaticJsonDocument<4096> doc;
   DeserializationError err = deserializeJson(doc, payload);
   if (err) {
     Serial.print("JSON parse error: ");
     Serial.println(err.c_str());
     return;
   }
 
   JsonArray rides = doc["rides"].as<JsonArray>();
   String foundId = "";
   String pickupName = "";
   String destName = "";
   String status = "";
 
   for (JsonObject ride : rides) {
     String s = ride["status"].as<String>();
     // focus on "pending" requests; you can widen this if needed
     if (s == "pending") {
       foundId = ride["id"].as<String>();
       status = s;
       // backend includes related locations for active type
       pickupName = ride["pickupLocation"]["name"] | ride["pickupLocationId"].as<String>();
       destName   = ride["destinationLocation"]["name"] | ride["destinationLocationId"].as<String>();
       break;
     }
   }
 
   if (foundId.length() == 0) {
     currentRideId = "";
     showNoRequest();
     return;
   }
 
   // Update state
   currentRideId = foundId;
   currentPickupName = pickupName;
   currentDestName = destName;
   currentStatus = status;
   hasRequest = true;
 
   Serial.println("Found pending ride:");
   Serial.println("  id = " + currentRideId);
   Serial.println("  from = " + currentPickupName);
   Serial.println("  to   = " + currentDestName);
 
   showCurrentRequest();
 }
 
 // Send PATCH /api/rides/[id] with action and optional pullerId
 bool sendRideAction(const String& rideId, const char* action) {
   if (rideId.length() == 0) return false;
 
  HTTPClient http;
 // BACKEND_BASE_URL already includes /api, so we omit it here
 String url = String(BACKEND_BASE_URL) + "/rides/" + rideId;
  http.begin(url);
   http.addHeader("Content-Type", "application/json");
 
   StaticJsonDocument<256> doc;
   doc["action"] = action;
   if (String(action) == "accept") {
     // backend resolves puller by ID/phone/name
     doc["pullerId"] = PULLER_ID;
   }
 
   String body;
   serializeJson(doc, body);
   Serial.printf("PATCH %s body=%s\n", url.c_str(), body.c_str());
 
   int code = http.PATCH(body);
   Serial.printf(" -> %d\n", code);
 
   http.end();
   return (code >= 200 && code < 300);
 }
 
 // ================== BUTTON HANDLING ==============
 
 void handleButtons() {
   if (millis() - lastButtonCheck < BUTTON_DEBOUNCE_MS) return;
   lastButtonCheck = millis();
 
   int acceptState = digitalRead(BUTTON_ACCEPT_PIN);
   int rejectState = digitalRead(BUTTON_REJECT_PIN);
 
   // Active LOW: pressed when state == LOW
 
   if (acceptState == LOW && lastAcceptState == HIGH && hasRequest) {
     Serial.println("Accept button pressed");
     showSplash("Accepting...");
     if (sendRideAction(currentRideId, "accept")) {
       showSplash("Accepted!");
     } else {
       showSplash("Accept failed");
     }
     delay(1000);
     // After decision, clear and repoll
     pollRequests();
   }
 
   if (rejectState == LOW && lastRejectState == HIGH && hasRequest) {
     Serial.println("Reject button pressed");
     showSplash("Rejecting...");
     if (sendRideAction(currentRideId, "reject")) {
       showSplash("Rejected");
     } else {
       showSplash("Reject failed");
     }
     delay(1000);
     pollRequests();
   }
 
   lastAcceptState = acceptState;
   lastRejectState = rejectState;
 }
 
 // ================== SETUP & LOOP =================
 
 void setup() {
   Serial.begin(115200);
   delay(500);
 
  pinMode(BUTTON_ACCEPT_PIN, INPUT_PULLUP);
  pinMode(BUTTON_REJECT_PIN, INPUT_PULLUP);

  // Initialize I2C on XIAO ESP32-C3 pins (SDA=20, SCL=21)
  Wire.begin(I2C_SDA, I2C_SCL);

   if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
     Serial.println("SSD1306 allocation failed");
     for (;;) delay(1000);
   }
   showSplash("Connecting WiFi");
 
   WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
   unsigned long start = millis();
   while (WiFi.status() != WL_CONNECTED) {
     delay(300);
     Serial.print(".");
     if (millis() - start > 15000) break;
   }
   Serial.println();
   if (WiFi.status() == WL_CONNECTED) {
     Serial.print("WiFi OK, IP=");
     Serial.println(WiFi.localIP());
     showSplash("WiFi Connected");
   } else {
     showSplash("WiFi FAILED");
   }
 
   // Mark puller online on backend
   if (WiFi.status() == WL_CONNECTED) {
     setPullerOnline(true);
   }
 
   delay(1000);
   showNoRequest();
   lastPoll = 0;
 }
 
 void loop() {
   if (WiFi.status() != WL_CONNECTED) {
     // Try to reconnect if lost
     WiFi.reconnect();
   }
 
   // Periodically poll for new requests
   if (millis() - lastPoll > POLL_INTERVAL_MS && WiFi.status() == WL_CONNECTED) {
     lastPoll = millis();
     pollRequests();
   }
 
   // Handle button presses anytime
   handleButtons();
 }