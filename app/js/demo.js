/* Electronics Inventory — example parts for trying the app (all tagged "example"). */
(function (App) {
  'use strict';

  const LOCATIONS = [
    { code: 'A1', name: 'Blue organizer', place: 'Place 1', color: '#2563eb', notes: 'Example location' },
    { code: 'A2', name: 'Orange organizer', place: 'Place 1', color: '#ea580c', notes: 'Example location' },
    { code: 'D1', name: 'Drawer 1', place: 'Place 2', color: '#6b7280', notes: 'Example location' },
  ];

  const PARTS = [
    {
      name: 'ESP32-C6-DevKitC-1',
      numbers: ['B-1'],
      category: 'dev-boards',
      description: 'Espressif development board with Wi-Fi 6, Bluetooth LE 5.3 and an 802.15.4 radio for Thread and Zigbee.',
      stock: [{ location: 'A1', qty: 2 }],
      specs: {
        mcu: 'ESP32-C6', architecture: 'RISC-V', wifi: 'Wi-Fi 6 (2.4 GHz)', bluetooth: '5.3', thread: '1.3', zigbee: true,
        usbConnector: 'USB-C', flash: '8 MB', logicLevel: '3.3 V',
      },
    },
    {
      name: 'ESP32-S3-DevKitC-1 (N16R8)',
      numbers: ['B-2'],
      category: 'dev-boards',
      description: 'Dual-core ESP32-S3 board with 16 MB flash and 8 MB PSRAM.',
      stock: [{ location: 'A1', qty: 1 }],
      specs: {
        mcu: 'ESP32-S3', architecture: 'Xtensa LX7', wifi: 'Wi-Fi 4 (2.4 GHz)', bluetooth: '5.0', usbConnector: 'USB-C',
        usbSerial: 'Native USB', flash: '16 MB', psram: '8 MB', logicLevel: '3.3 V',
      },
    },
    {
      name: 'Raspberry Pi Pico W',
      category: 'dev-boards',
      description: 'RP2040 board with an Infineon CYW43439 wireless chip.',
      stock: [{ location: 'A1', qty: 2 }],
      specs: {
        mcu: 'RP2040', architecture: 'ARM Cortex-M0+', wifi: 'Wi-Fi 4 (2.4 GHz)', bluetooth: '5.2', usbConnector: 'Micro-USB',
        usbSerial: 'Native USB', flash: '2 MB', clock: 133, logicLevel: '3.3 V',
      },
    },
    {
      name: 'Arduino Nano (CH340 clone)',
      category: 'dev-boards',
      description: 'Classic ATmega328P board in the Nano form factor.',
      stock: [{ location: 'D1', qty: 3 }],
      specs: {
        mcu: 'ATmega328P', architecture: 'AVR', usbConnector: 'Mini-USB', usbSerial: 'CH340', flash: '32 KB', clock: 16,
        logicLevel: '5 V', formFactor: 'Arduino Nano',
      },
    },
    {
      name: 'Wemos D1 Mini',
      category: 'dev-boards',
      description: 'Small ESP8266 board. Amount unknown — shows how unknown quantities look.',
      stock: [{ location: 'D1', qty: null }],
      specs: {
        mcu: 'ESP8266', architecture: 'Xtensa L106', wifi: 'Wi-Fi 4 (2.4 GHz)', usbConnector: 'Micro-USB', usbSerial: 'CH340',
        flash: '4 MB', logicLevel: '3.3 V', formFactor: 'Wemos D1 Mini',
      },
    },
    {
      name: 'nRF52840 USB dongle',
      category: 'dev-boards',
      description: 'Nordic nRF52840 in a USB stick — Bluetooth LE, Thread and Zigbee.',
      stock: [{ location: 'A2', qty: 1 }],
      specs: {
        mcu: 'nRF52840', architecture: 'ARM Cortex-M4', bluetooth: '5.0', thread: '1.3', zigbee: true, usbConnector: 'USB-A',
        usbSerial: 'Native USB', flash: '1 MB', logicLevel: '3.3 V',
      },
    },
    {
      name: 'BME280 breakout',
      numbers: ['1'],
      category: 'sensors',
      description: 'Temperature, humidity and pressure sensor.',
      stock: [{ location: 'A2', qty: 2 }],
      specs: { measures: ['Temperature', 'Humidity', 'Pressure'], chip: 'BME280', interfaces: ['I2C', 'SPI'], supplyVoltage: '3.3 V' },
    },
    {
      name: 'HC-SR04 ultrasonic sensor',
      numbers: ['2'],
      category: 'sensors',
      description: 'Ultrasonic distance sensor.',
      stock: [{ location: 'A2', qty: 3 }, { location: 'D1', qty: 1 }],
      specs: { measures: ['Distance'], chip: 'HC-SR04', interfaces: ['Digital'], supplyVoltage: '5 V', range: '2–400 cm' },
    },
    {
      name: 'OLED 0.96" 128×64 (I2C)',
      category: 'displays',
      description: 'Small monochrome OLED module.',
      stock: [{ location: 'A1', qty: 3 }],
      specs: {
        displayType: 'OLED', diagonal: 0.96, resolution: '128×64', driver: 'SSD1306', colors: 'Monochrome', touch: 'None',
        interfaces: ['I2C'], supplyVoltage: '3.3–5 V',
      },
    },
    {
      name: 'TFT 1.8" 128×160 (SPI)',
      category: 'displays',
      description: 'Color TFT module with an SD card slot.',
      stock: [{ location: 'A1', qty: 1 }],
      specs: {
        displayType: 'TFT LCD', diagonal: 1.8, resolution: '128×160', driver: 'ST7735S', colors: 'Color', touch: 'None',
        interfaces: ['SPI'], supplyVoltage: '3.3–5 V',
      },
    },
    {
      name: 'LM2596 buck converter module',
      category: 'power',
      description: 'Adjustable step-down converter.',
      stock: [{ location: 'D1', qty: 5 }],
      specs: {
        powerType: 'Buck (step-down)', chip: 'LM2596', inputVoltage: '4–40 V', outputVoltage: '1.25–37 V', maxCurrent: '3 A',
        adjustable: true,
      },
    },
    {
      name: 'TP4056 Li-ion charger (USB-C)',
      category: 'power',
      description: 'Single-cell lithium battery charger with protection.',
      stock: [{ location: 'D1', qty: 6 }],
      specs: { powerType: 'Battery charger', chip: 'TP4056', inputVoltage: '5 V', outputVoltage: '4.2 V', maxCurrent: '1 A' },
    },
    {
      name: 'SG90 micro servo',
      category: 'motors',
      description: '9 g plastic gear servo.',
      stock: [{ location: 'A2', qty: 4 }],
      specs: { motorType: 'Servo', supplyVoltage: '4.8–6 V', interfaces: ['PWM'] },
    },
    {
      name: 'Relay module, 1 channel, 5 V',
      category: 'switching',
      description: 'Opto-isolated relay board.',
      stock: [{ location: 'D1', qty: 2 }],
      specs: { switchType: 'Relay', channels: 1, loadRating: '10 A / 250 VAC', trigger: 'Active low', supplyVoltage: '5 V' },
    },
    {
      name: 'WS2812B LED strip, 60 LED/m',
      category: 'leds',
      description: 'Addressable RGB strip, 1 m.',
      stock: [{ location: 'D1', qty: 1 }],
      specs: { ledType: 'LED strip', chip: 'WS2812B', supplyVoltage: '5 V' },
      notes: 'Quantity is in meters.',
    },
    {
      name: 'SX1278 LoRa module Ra-02',
      category: 'comm',
      description: '433 MHz LoRa transceiver with an IPEX antenna connector.',
      stock: [{ location: 'A2', qty: 2 }],
      specs: { protocols: ['LoRa'], chip: 'SX1278', frequency: '433 MHz', interfaces: ['SPI'], supplyVoltage: '3.3 V' },
    },
    {
      name: 'NE555 timer',
      category: 'ics',
      description: 'Classic timer IC.',
      stock: [{ location: 'D1', qty: 10 }],
      specs: { icType: 'Timer', chip: 'NE555', package: 'DIP-8', supplyVoltage: '4.5–16 V' },
    },
    {
      name: 'Resistor kit 1/4 W',
      category: 'passives',
      description: 'Metal film resistors, 30 values.',
      stock: [{ location: 'D1', qty: 1 }],
      specs: { passiveType: 'Resistor kit', value: '10 Ω – 1 MΩ', tolerance: '1 %', rating: '0.25 W' },
      notes: '30 values × 20 pcs.',
    },
  ];

  function load() {
    const U = App.util;
    const S = App.schema;
    return App.store.commit('demo', (draft) => {
      for (const raw of LOCATIONS) {
        if (!S.locationByCode(draft, raw.code)) draft.locations.push(S.normalizeLocation(raw));
      }
      const taken = new Set(draft.parts.map((part) => part.id));
      const now = U.nowIso();
      for (const raw of PARTS) {
        const id = U.uniqueId(U.slugify(raw.name), taken);
        taken.add(id);
        const part = S.normalizePart({ ...raw, id, tags: ['example'], createdAt: now, updatedAt: now });
        S.ensureReferences(draft, part);
        draft.parts.push(part);
      }
      return PARTS.length;
    });
  }

  App.demo = { load };
})(window.App = window.App || {});
