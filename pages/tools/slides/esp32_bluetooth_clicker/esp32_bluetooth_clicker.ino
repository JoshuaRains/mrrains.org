#include <Arduino.h>

#if defined(CONFIG_IDF_TARGET_ESP32)
  #include "BluetoothSerial.h"
  #define SLIDES_CLICKER_HAS_BT_SERIAL 1
#else
  #define SLIDES_CLICKER_HAS_BT_SERIAL 0
#endif

// ESP32 USB/Bluetooth serial clicker for pages/tools/slides/index.html
// For quick testing, plug the ESP32 in over USB and choose its USB serial port.
// For wireless use, pair it as a Bluetooth serial device and choose that COM port.
// Both paths emit the same newline-delimited JSON events.

constexpr char DEVICE_NAME[] = "SlidesClicker";
constexpr char DEVICE_ID[] = "teacher-clicker-01";
constexpr uint32_t BAUD_RATE = 115200;
constexpr uint16_t DEBOUNCE_MS = 35;
constexpr uint32_t STATUS_INTERVAL_MS = 5000;

struct ButtonConfig {
  uint8_t pin;
  uint8_t id;
  const char* command;
  const char* label;
};

// Wire each button from the printed Nano ESP32 D pin to GND.
// INPUT_PULLUP keeps the idle state HIGH.
// Every button emits USB Serial output. Classic ESP32 boards also mirror it over Bluetooth Serial.
// Buttons 4-8 intentionally emit extra-* commands for future slide controls.
ButtonConfig buttons[] = {
  {D2, 1, "timer", "Open timer"},
  {D3, 2, "sound", "Play sound"},
  {D4, 3, "desk-roll", "Desk roll"},
  {D5, 4, "extra-4", "Extra 4"},
  {D6, 5, "extra-5", "Extra 5"},
  {D7, 6, "extra-6", "Extra 6"},
  {D8, 7, "extra-7", "Extra 7"},
  {D9, 8, "extra-8", "Extra 8"},
};

struct ButtonState {
  bool stablePressed = false;
  bool lastReadingPressed = false;
  uint32_t changedAt = 0;
  uint32_t pressedAt = 0;
};

#if SLIDES_CLICKER_HAS_BT_SERIAL
BluetoothSerial SerialBT;
#endif
ButtonState states[sizeof(buttons) / sizeof(buttons[0])];
uint32_t packetSequence = 0;
uint32_t lastStatusAt = 0;

void writeAll(const String& line) {
  Serial.println(line);
#if SLIDES_CLICKER_HAS_BT_SERIAL
  if (SerialBT.hasClient()) {
    SerialBT.println(line);
  }
#endif
}

String jsonString(const char* value) {
  String out = "\"";
  for (const char* p = value; *p; ++p) {
    if (*p == '\\' || *p == '\"') out += '\\';
    out += *p;
  }
  out += "\"";
  return out;
}

void emitStatus() {
  String line = "{\"type\":\"status\"";
  line += ",\"device\":"; line += jsonString(DEVICE_ID);
  line += ",\"name\":"; line += jsonString(DEVICE_NAME);
  line += ",\"packets\":"; line += String(packetSequence);
  line += ",\"buttons\":"; line += String(sizeof(buttons) / sizeof(buttons[0]));
#if SLIDES_CLICKER_HAS_BT_SERIAL
  line += ",\"bluetoothClient\":"; line += String(SerialBT.hasClient() ? "true" : "false");
#else
  line += ",\"bluetoothClient\":false";
#endif
  line += ",\"uptimeMs\":"; line += String(millis());
  line += "}";
  writeAll(line);
}

void emitButtonEvent(const ButtonConfig& button, const char* action, uint32_t heldMs = 0) {
  packetSequence += 1;
  String line = "{\"type\":\"clicker\"";
  line += ",\"device\":"; line += jsonString(DEVICE_ID);
  line += ",\"name\":"; line += jsonString(DEVICE_NAME);
  line += ",\"button\":"; line += String(button.id);
  line += ",\"pin\":"; line += String(button.pin);
  line += ",\"action\":"; line += jsonString(action);
  line += ",\"command\":"; line += jsonString(button.command);
  line += ",\"label\":"; line += jsonString(button.label);
  line += ",\"heldMs\":"; line += String(heldMs);
  line += ",\"sequence\":"; line += String(packetSequence);
  line += ",\"uptimeMs\":"; line += String(millis());
  line += "}";
  writeAll(line);
}

void setup() {
  Serial.begin(BAUD_RATE);
  delay(200);

  for (size_t i = 0; i < sizeof(buttons) / sizeof(buttons[0]); ++i) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
    states[i].lastReadingPressed = digitalRead(buttons[i].pin) == LOW;
    states[i].stablePressed = states[i].lastReadingPressed;
    states[i].changedAt = millis();
  }

#if SLIDES_CLICKER_HAS_BT_SERIAL
  SerialBT.begin(DEVICE_NAME);
#endif
  emitStatus();
}

void loop() {
  const uint32_t now = millis();

  for (size_t i = 0; i < sizeof(buttons) / sizeof(buttons[0]); ++i) {
    const bool readingPressed = digitalRead(buttons[i].pin) == LOW;

    if (readingPressed != states[i].lastReadingPressed) {
      states[i].lastReadingPressed = readingPressed;
      states[i].changedAt = now;
    }

    if ((now - states[i].changedAt) >= DEBOUNCE_MS && readingPressed != states[i].stablePressed) {
      states[i].stablePressed = readingPressed;
      if (readingPressed) {
        states[i].pressedAt = now;
        emitButtonEvent(buttons[i], "pressed");
      } else {
        emitButtonEvent(buttons[i], "released", now - states[i].pressedAt);
      }
    }
  }

  if (now - lastStatusAt >= STATUS_INTERVAL_MS) {
    lastStatusAt = now;
    emitStatus();
  }
}