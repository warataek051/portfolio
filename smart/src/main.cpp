// ===== ESP32 + DSM501A + DHT11 + MQ-2 (แบบ Interrupt + Smooth ค่าฝุ่น + MQTT/TLS) =====
// ⚙️ การต่อสาย (Wiring)
// DSM501A:  Vout1 -> GPIO32,  Vout2 -> GPIO33  (อ่านเวลาที่สัญญาณเป็น LOW ด้วย interrupt)
// DHT11:     DATA  -> GPIO2   (มีตัวต้านทาน pull-up 10kΩ ระหว่าง DATA กับ VCC)
// MQ-2:      DO    -> GPIO34  (สัญญาณดิจิทัล LOW = ตรวจพบก๊าซ), AO -> GPIO35 (แรงดัน 0–3.3V)

// ---------- ไลบรารีที่ใช้ ----------
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#include <esp_system.h>
#include <DHT.h>

// ---------- ข้อมูล Wi-Fi ----------
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ---------- ข้อมูลเซิร์ฟเวอร์ MQTT (HiveMQ Cloud ผ่าน TLS) ----------
const char* MQTT_BROKER   = "YOUR_CLUSTER.s1.eu.hivemq.cloud";
const uint16_t MQTT_PORT  = 8883;
const char* MQTT_USERNAME = "YOUR_MQTT_USERNAME";
const char* MQTT_PASSWORD = "YOUR_MQTT_PASSWORD";

// ตั้งหัวข้อ MQTT (จะกำหนดจริงตอนรัน)
char MQTT_TOPIC[96] = {0};

// ---------- ใบรับรอง SSL ----------
static const char ROOT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
...ใส่ใบรับรอง ROOT CA ของ HiveMQ Cloud ตรงนี้...
-----END CERTIFICATE-----
)EOF";

// ---------- ตัวแปรระบบ ----------ฆ
WiFiClientSecure secureClient;  
PubSubClient mqttClient(secureClient);

char clientId[40] = {0};     // ใช้ MAC ของบอร์ดสร้างชื่อเฉพาะ
bool timeSynced = false;     // สถานะว่าซิงค์เวลา NTP แล้วหรือยัง

unsigned long lastWifiRetry = 0;
unsigned long lastMqttRetry = 0;
const unsigned long WIFI_RETRY_MS = 10000;
const unsigned long MQTT_RETRY_MS = 5000;

// ---------- ตั้งค่าของ DSM501A ----------
const int PIN_VOUT1 = 32;
const int PIN_VOUT2 = 33;
const unsigned long SAMPLE_TIME_MS = 10000; // เก็บข้อมูลทุก 10 วินาที

// ใช้ interrupt ในการนับเวลาที่สัญญาณเป็น LOW
volatile unsigned long lpoAccum1 = 0;
volatile unsigned long lpoAccum2 = 0;
volatile bool lowActive1 = false;
volatile bool lowActive2 = false;
volatile unsigned long lowStart1 = 0;
volatile unsigned long lowStart2 = 0;

// ฟังก์ชันย่อสำหรับอ่าน micros()
inline unsigned long _us() { return (unsigned long) micros(); }

// --- ฟังก์ชัน interrupt สำหรับ DSM501A ---
void IRAM_ATTR isr_ch1() {
  int lvl = digitalRead(PIN_VOUT1);
  unsigned long now = _us();
  if (lvl == LOW) {              // เมื่อสัญญาณเปลี่ยนลง LOW → เริ่มจับเวลา
    lowActive1 = true;
    lowStart1 = now;
  } else if (lowActive1) {       // เมื่อกลับขึ้น HIGH → หยุดจับเวลา
    lpoAccum1 += (now - lowStart1);
    lowActive1 = false;
  }
}

void IRAM_ATTR isr_ch2() {
  int lvl = digitalRead(PIN_VOUT2);
  unsigned long now = _us();
  if (lvl == LOW) {
    lowActive2 = true;
    lowStart2 = now;
  } else if (lowActive2) {
    lpoAccum2 += (now - lowStart2);
    lowActive2 = false;
  }
}

// ---------- DHT11 ----------
#define DHTPIN 2
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// ---------- MQ-2 ----------
const int MQ2_DO_PIN = 34;
const int MQ2_AO_PIN = 35;
const float RL = 5.0f;   // ตัวต้านทานโหลด 5kΩ
float Ro = 10.0f;        // ค่าความต้านทานอากาศสะอาด (คาลิเบรตเอง)

// ---------- ฟังก์ชันช่วยเหลือ ----------
bool wifiConfigured() {
  return strcmp(WIFI_SSID, "YOUR_WIFI_SSID") != 0 && WIFI_SSID[0] != '\0';
}

// ฟังก์ชันทำค่าให้นิ่งขึ้น (Exponential Smoothing)
float expSmooth(float prev, float x, float alpha) {
  if (!isfinite(prev)) return x;
  return alpha * x + (1.0f - alpha) * prev;
}

// ฟังก์ชันแปลงค่า ADC → PPM สำหรับ MQ-2
float MQ2_getPPM(int rawADC) {
  float Vrl = 3.3f * (float)rawADC / 4095.0f;
  if (Vrl <= 0.01f) Vrl = 0.01f; // กันการหารด้วยศูนย์
  float Rs = (3.3f - Vrl) * RL / Vrl;   // คำนวณ Rs
  float RsRo = Rs / Ro;
  float ppm = 1000.0f * powf(RsRo, -2.2f); // สมการประมาณค่าควัน/LPG
  return ppm;
}

// ฟังก์ชันสร้าง clientId ตาม MAC ของบอร์ด
void makeClientId() {
  if (clientId[0]) return;
  uint64_t chipId = ESP.getEfuseMac();
  snprintf(clientId, sizeof(clientId), "esp32-sensor-%04X%08X",
           (uint16_t)(chipId >> 32), (uint32_t)chipId);
  snprintf(MQTT_TOPIC, sizeof(MQTT_TOPIC),
           "orchard/%s/telemetry", clientId);
}

// ฟังก์ชันเชื่อมต่อ Wi-Fi
void connectWiFi() {
  if (!wifiConfigured()) {
    Serial.println("[WiFi] โปรดตั้งค่า SSID และรหัสผ่านก่อน");
    return;
  }
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] กำลังเชื่อมต่อ \"%s\"", WIFI_SSID);
  for (int i = 0; i < 60 && WiFi.status() != WL_CONNECTED; ++i) {
    Serial.print(".");
    delay(500);
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] เชื่อมต่อสำเร็จ IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WiFi] เชื่อมต่อไม่สำเร็จ จะลองใหม่อีกครั้ง");
  }
}

// ฟังก์ชันซิงค์เวลาจากเซิร์ฟเวอร์ NTP
bool syncTimeNTP() {
  if (timeSynced) return true;
  if (WiFi.status() != WL_CONNECTED) return false;

  Serial.println("[NTP] กำลังซิงค์เวลา...");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
  unsigned long start = millis();
  time_t now = time(nullptr);
  while (now < 1700000000 && (millis() - start) < 20000) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println();
  timeSynced = (now >= 1700000000);
  Serial.println(timeSynced ? "[NTP] ซิงค์เวลาเสร็จสิ้น" : "[NTP] ซิงค์เวลาไม่สำเร็จ");
  return timeSynced;
}

// ฟังก์ชันตรวจสอบและเชื่อมต่อ MQTT
bool ensureMqtt() {
  if (mqttClient.connected()) return true;
  if (WiFi.status() != WL_CONNECTED) return false;
  if (!timeSynced) { syncTimeNTP(); if (!timeSynced) return false; }

  makeClientId();
  Serial.printf("[MQTT] กำลังเชื่อมต่อในชื่อ %s ... ", clientId);
  bool ok = mqttClient.connect(clientId, MQTT_USERNAME, MQTT_PASSWORD);
  Serial.println(ok ? "สำเร็จ" : "ล้มเหลว");
  return ok;
}

// ฟังก์ชันส่งข้อมูลไป MQTT เป็น JSON
bool publishJson(float ratio1, float ratio2,
                 float ug1, float ug2,
                 bool dhtOk, float hum, float temp,
                 int mq2Analog, int mq2Digital, float mq2PPM) {
  if (!mqttClient.connected()) return false;

  char payload[700];
  unsigned long epoch = timeSynced ? (unsigned long) time(nullptr) : 0;

  int n = snprintf(payload, sizeof(payload),
    "{\"device\":\"%s\",\"timestamp\":%lu,\"sample_ms\":%lu,"
    "\"dust\":{\"ratio1\":%.2f,\"ratio2\":%.2f,\"ugm3_ch1\":%.2f,\"ugm3_ch2\":%.2f},"
    "\"dht\":{\"valid\":%s,\"temperature_c\":%.1f,\"humidity_pct\":%.1f},"
    "\"mq2\":{\"ppm\":%.2f,\"analog\":%d,\"digital_alert\":%s}}",
    clientId, epoch, SAMPLE_TIME_MS,
    ratio1, ratio2, ug1, ug2,
    dhtOk ? "true" : "false",
    dhtOk ? temp : 0.0f, dhtOk ? hum : 0.0f,
    mq2PPM, mq2Analog, (mq2Digital == LOW) ? "true" : "false");

  if (n <= 0 || n >= (int)sizeof(payload)) {
    Serial.println("[MQTT] ข้อมูลใหญ่เกินไป ไม่สามารถส่งได้");
    return false;
  }

  Serial.printf("[MQTT] ส่งข้อมูลไปยัง %s\n", MQTT_TOPIC);
  bool ok = mqttClient.publish(MQTT_TOPIC, payload, false);
  if (!ok) Serial.println("[MQTT] ส่งข้อมูลล้มเหลว");
  else Serial.println(payload);
  return ok;
}

// ---------- ตัวแปรควบคุมการวัด ----------
unsigned long sampleStartMs = 0;
float ugm3_1_smooth = NAN, ugm3_2_smooth = NAN;

// ---------- เริ่มต้นโปรแกรม ----------
void setup() {
  Serial.begin(115200);
  delay(200);

  makeClientId();
  secureClient.setCACert(ROOT_CA);
  secureClient.setTimeout(15000);

  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setBufferSize(700);
  mqttClient.setKeepAlive(30);

  pinMode(PIN_VOUT1, INPUT);
  pinMode(PIN_VOUT2, INPUT);
  attachInterrupt(PIN_VOUT1, isr_ch1, CHANGE);
  attachInterrupt(PIN_VOUT2, isr_ch2, CHANGE);

  dht.begin();
  pinMode(MQ2_DO_PIN, INPUT);

  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) {
    syncTimeNTP();
    ensureMqtt();
  }

  sampleStartMs = millis();
  Serial.println("=== เริ่มระบบวัดคุณภาพอากาศ ESP32 (Interrupt) ===");
}

// ---------- ลูปหลัก ----------
void loop() {
  // 🔹 ตรวจสอบการเชื่อมต่อ Wi-Fi และ MQTT ตลอดเวลา
  if (WiFi.status() != WL_CONNECTED && wifiConfigured()) {
    if (millis() - lastWifiRetry > WIFI_RETRY_MS) {
      lastWifiRetry = millis();
      connectWiFi();
      if (WiFi.status() == WL_CONNECTED) timeSynced = false;
    }
  } else if (!timeSynced) {
    syncTimeNTP();
  }

  if (!mqttClient.connected()) {
    if (millis() - lastMqttRetry > MQTT_RETRY_MS) {
      lastMqttRetry = millis();
      ensureMqtt();
    }
  }
  mqttClient.loop();
  // 🔹 ครบเวลาการวัดหนึ่งรอบหรือยัง
  if (millis() - sampleStartMs >= SAMPLE_TIME_MS) {
    noInterrupts();
    unsigned long endUs = _us();
    if (lowActive1) { lpoAccum1 += (endUs - lowStart1); lowActive1 = false; }
    if (lowActive2) { lpoAccum2 += (endUs - lowStart2); lowActive2 = false; }
    unsigned long us1 = lpoAccum1;
    unsigned long us2 = lpoAccum2;
    lpoAccum1 = lpoAccum2 = 0;
    interrupts();

    float ratio1 = (us1 / 1000.0f) / (float)SAMPLE_TIME_MS * 100.0f;
    float ratio2 = (us2 / 1000.0f) / (float)SAMPLE_TIME_MS * 100.0f;

    // คำนวณความเข้มข้นฝุ่น (µg/m³)
    float ug1 = 1.1f * powf(ratio1, 3) - 3.8f * powf(ratio1, 2) + 520.0f * ratio1 + 0.62f;
    float ug2 = 1.1f * powf(ratio2, 3) - 3.8f * powf(ratio2, 2) + 520.0f * ratio2 + 0.62f;

    // ทำค่าให้เรียบขึ้น (Smoothing)
    ugm3_1_smooth = expSmooth(ugm3_1_smooth, ug1, 0.35f);
    ugm3_2_smooth = expSmooth(ugm3_2_smooth, ug2, 0.35f);

    Serial.println("\n===== ผลการวัด DSM501A =====");
    Serial.printf("CH1: %.2f ms (%.2f%%)  ฝุ่น: %.2f µg/m³ (เฉลี่ย: %.2f)\n",
                  us1/1000.0f, ratio1, ug1, ugm3_1_smooth);
    Serial.printf("CH2: %.2f ms (%.2f%%)  ฝุ่น: %.2f µg/m³ (เฉลี่ย: %.2f)\n",
                  us2/1000.0f, ratio2, ug2, ugm3_2_smooth);

    // อ่านค่า DHT11
    float h = dht.readHumidity();
    float t = dht.readTemperature();
    bool dhtOk = !(isnan(h) || isnan(t));
    if (!dhtOk) Serial.println("ไม่สามารถอ่านค่า DHT11 ได้");

    // อ่านค่า MQ-2
    int mq2_dig = digitalRead(MQ2_DO_PIN);
    int mq2_adc = analogRead(MQ2_AO_PIN);
    float mq2_ppm = MQ2_getPPM(mq2_adc);

    Serial.println("===== ผลการวัด MQ-2 =====");
    Serial.printf("DO: %s\n", (mq2_dig == LOW) ? "ตรวจพบก๊าซ!" : "ไม่มีการตรวจพบ");
    Serial.printf("AO: %d (0–4095)\n", mq2_adc);
    Serial.printf("ค่าประมาณ PPM: %.2f ppm\n", mq2_ppm);

    // ส่งข้อมูลทั้งหมดผ่าน MQTT
    publishJson(ratio1, ratio2, ugm3_1_smooth, ugm3_2_smooth,
                dhtOk, h, t, mq2_adc, mq2_dig, mq2_ppm);

    // รีเซ็ตค่าเวลาเพื่อเริ่มรอบใหม่
    sampleStartMs = millis();
  }
}
