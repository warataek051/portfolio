import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Text } from "react-native";
import { Stack } from "expo-router"; // ✅ ต้องมี
import mqttModule, { connect as namedConnect, IClientOptions, MqttClient } from "mqtt";
import DashboardCard from "../components/dashboard/DashboardCard";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "error";

interface HiveMqPayload {
  timestamp?: number;
  sample_ms?: number;
  dust?: {
    ratio1?: number;
    ratio2?: number;
    ugm3_ch1?: number;
    ugm3_ch2?: number;
  };
  dht?: {
    valid?: boolean;
    temperature_c?: number;
    humidity_pct?: number;
  };
  mq2?: {
    ppm?: number;
    analog?: number;
    digital_alert?: boolean;
  };
}

interface AirQualityData {
  temperature: number | null;
  humidity: number | null;
  pm25: number | null;
  pm10: number | null;
  smoke: number | null;
  mq2Analog: number | null;
  mq2Digital: boolean | null;
  timestamp: Date | string;
  raw?: HiveMqPayload;
}

// HiveMQ Cloud (Let's Encrypt / ISRG Root X1 trusted by Expo)
const MQTT_ENDPOINT = "wss://bb5e3e52ed0842aa824f5c3a12ddf2cc.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_TOPIC = "sensor";
// TODO: move credentials to secure storage / app config when provisioning for production.
const MQTT_OPTIONS: IClientOptions = {
  username: "warataek051",
  password: "Hesoyam2547zz!",
  clean: true,
  reconnectPeriod: 4000,
  connectTimeout: 7000,
  keepalive: 60,
  clientId: `web-monitor-${Date.now()}`,
};

const MAX_HISTORY = 240;

const resolveMqttConnect = (): ((
  brokerUrl: string,
  options?: IClientOptions
) => MqttClient) => {
  const moduleAny = mqttModule as unknown as {
    connect?: unknown;
    default?: unknown;
  };

  const candidates: Array<unknown> = [
    namedConnect,
    moduleAny?.connect,
    (moduleAny?.default as { connect?: unknown } | undefined)?.connect,
    moduleAny?.default,
    typeof mqttModule === "function" ? mqttModule : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate as (brokerUrl: string, options?: IClientOptions) => MqttClient;
    }
  }

  throw new Error("Unable to resolve MQTT connect export");
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const mapPayloadToReading = (payload: HiveMqPayload): AirQualityData => {
  const pm10 = toNumber(payload.dust?.ugm3_ch1);
  const pm25 = toNumber(payload.dust?.ugm3_ch2);
  const tempValid = payload.dht?.valid;
  const temperature = tempValid ? toNumber(payload.dht?.temperature_c) : null;
  const humidity = tempValid ? toNumber(payload.dht?.humidity_pct) : null;
  const smoke = toNumber(payload.mq2?.ppm);
  const mq2Analog = toNumber(payload.mq2?.analog);
  const mq2Digital =
    typeof payload.mq2?.digital_alert === "boolean" ? payload.mq2.digital_alert : null;
  const tsRaw = toNumber(payload.timestamp);
  const tsMs = tsRaw != null ? (tsRaw > 1_000_000_000_000 ? tsRaw : tsRaw * 1000) : Date.now();

  return {
    pm10,
    pm25,
    temperature,
    humidity,
    smoke,
    mq2Analog,
    mq2Digital,
    timestamp: new Date(tsMs),
    raw: payload,
  };
};

export default function DashboardScreen() {
  const [history, setHistory] = useState<AirQualityData[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);

  const data = useMemo(() => history[history.length - 1] ?? null, [history]);

  useEffect(() => {
    let connectFn: (brokerUrl: string, options?: IClientOptions) => MqttClient;

    try {
      connectFn = resolveMqttConnect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to resolve MQTT connect export", err);
      setConnectionStatus("error");
      setLastError(message);
      return undefined;
    }

    const client = connectFn(MQTT_ENDPOINT, MQTT_OPTIONS);

    setConnectionStatus("connecting");
    setLastError(null);

    client.on("connect", () => {
      setConnectionStatus("connected");
      setLastError(null);
      client.subscribe(MQTT_TOPIC, { qos: 1 }, (err) => {
        if (err) {
          setLastError(err.message);
        }
      });
    });

    client.on("reconnect", () => {
      setConnectionStatus("reconnecting");
    });

    client.on("error", (err) => {
      console.error("MQTT error", err);
      setLastError(err.message);
      setConnectionStatus("error");
    });

    client.on("close", () => {
      if (client.disconnecting) {
        return;
      }
      setConnectionStatus((prev) => (prev === "error" ? prev : "reconnecting"));
    });

    client.on("message", (_topic, payload) => {
      try {
        const json = JSON.parse(payload.toString()) as HiveMqPayload;
        const reading = mapPayloadToReading(json);
        setHistory((prev) => {
          const next = [...prev, reading];
          if (next.length > MAX_HISTORY) {
            next.splice(0, next.length - MAX_HISTORY);
          }
          return next;
        });
      } catch (err) {
        console.warn("Failed to parse MQTT payload", err);
        setLastError(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      client.removeAllListeners();
      client.end(true);
    };
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ padding: 12, backgroundColor: "#f5f5f5" }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Dashboard</Text>
        <Text style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
          สถานะการเชื่อมต่อ: {connectionStatus}
        </Text>
        {lastError ? (
          <Text style={{ marginTop: 2, fontSize: 12, color: "#dc2626" }} numberOfLines={2}>
            ข้อผิดพลาด: {lastError}
          </Text>
        ) : null}
      </View>

      <DashboardCard
        data={data ?? null}
        history={history}
        connectionStatus={connectionStatus}
      />
    </SafeAreaView>
  );
}
