import { useState, useEffect, useCallback, useRef } from "react";
import Constants from "expo-constants";

const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();

function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim()
    ?? (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined)?.trim();

  if (configured) return configured;
  if (appEnv === "production") return "https://api.chainshorts.live";
  return "http://localhost:8787";
}

export interface LiveOddsData {
  yesOdds: number;
  noOdds: number;
  yesPct: number;
  noPct: number;
  totalPoolSkr: number;
  yesPoolSkr: number;
  noPoolSkr: number;
  totalStakers: number;
  updatedAt: string;
}

interface UsePredictionOddsResult {
  odds: LiveOddsData | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  reconnect: () => void;
}

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const POLL_FALLBACK_INTERVAL_MS = 5000;

/**
 * React hook for live odds updates via Server-Sent Events (SSE).
 *
 * Connects to /v1/predictions/:id/stream and automatically reconnects
 * on disconnect up to MAX_RECONNECT_ATTEMPTS times.
 *
 * @param pollId - The prediction market poll ID
 * @param enabled - Whether to enable the SSE connection (default: true)
 * @returns { odds, loading, error, connected, reconnect }
 */
export function usePredictionOdds(
  pollId: string | null,
  enabled: boolean = true
): UsePredictionOddsResult {
  const [odds, setOdds] = useState<LiveOddsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setConnected(false);
  }, []);

  const fetchOddsViaHttp = useCallback(async () => {
    if (!pollId || !mountedRef.current) return;
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/v1/predictions/${encodeURIComponent(pollId)}/pool`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!mountedRef.current) return;
      setOdds({
        yesOdds: data.yesOdds ?? 1,
        noOdds: data.noOdds ?? 1,
        yesPct: data.yesPct ?? 50,
        noPct: data.noPct ?? 50,
        totalPoolSkr: data.totalPoolSkr ?? 0,
        yesPoolSkr: data.yesPoolSkr ?? 0,
        noPoolSkr: data.noPoolSkr ?? 0,
        totalStakers: data.totalStakers ?? 0,
        updatedAt: data.updatedAt ?? new Date().toISOString(),
      });
      setLoading(false);
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      setError("Failed to fetch odds");
      setLoading(false);
    }
  }, [pollId]);

  const connect = useCallback(() => {
    if (!pollId || !enabled || !mountedRef.current) return;

    cleanup();

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/v1/predictions/${encodeURIComponent(pollId)}/stream`;

    setLoading(true);
    setError(null);

    if (typeof EventSource === "undefined") {
      void fetchOddsViaHttp();
      pollingIntervalRef.current = setInterval(() => {
        void fetchOddsViaHttp();
      }, POLL_FALLBACK_INTERVAL_MS);
      return;
    }

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        setLoading(false);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      es.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const data = JSON.parse(event.data) as Partial<LiveOddsData>;

          setOdds((prev) => ({
            yesOdds: data.yesOdds ?? prev?.yesOdds ?? 1,
            noOdds: data.noOdds ?? prev?.noOdds ?? 1,
            yesPct: data.yesPct ?? prev?.yesPct ?? 50,
            noPct: data.noPct ?? prev?.noPct ?? 50,
            totalPoolSkr: data.totalPoolSkr ?? prev?.totalPoolSkr ?? 0,
            yesPoolSkr: data.yesPoolSkr ?? prev?.yesPoolSkr ?? 0,
            noPoolSkr: data.noPoolSkr ?? prev?.noPoolSkr ?? 0,
            totalStakers: data.totalStakers ?? prev?.totalStakers ?? 0,
            updatedAt: data.updatedAt ?? new Date().toISOString(),
          }));

          setLoading(false);
        } catch {
          // Ignore malformed messages
        }
      };

      es.onerror = () => {
        if (!mountedRef.current) return;

        setConnected(false);
        es.close();
        eventSourceRef.current = null;

        // Auto-reconnect with backoff
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_DELAY_MS * (reconnectAttemptsRef.current + 1);
          reconnectAttemptsRef.current += 1;

          setError(`Connection lost. Reconnecting in ${Math.round(delay / 1000)}s...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        } else {
          setError("Unable to connect to live updates. Pull to refresh.");
          setLoading(false);
        }
      };

      // Handle specific event types if the server sends named events
      es.addEventListener("odds", (event: MessageEvent) => {
        if (!mountedRef.current) return;

        try {
          const data = JSON.parse(event.data) as LiveOddsData;
          setOdds(data);
        } catch {
          // Ignore malformed messages
        }
      });

      es.addEventListener("pool", (event: MessageEvent) => {
        if (!mountedRef.current) return;

        try {
          const data = JSON.parse(event.data) as Partial<LiveOddsData>;
          setOdds((prev) => (prev ? { ...prev, ...data } : null));
        } catch {
          // Ignore malformed messages
        }
      });
    } catch (err) {
      setError("Failed to establish connection");
      setLoading(false);
      setConnected(false);
    }
  }, [pollId, enabled, cleanup, fetchOddsViaHttp]);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;

    if (pollId && enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [pollId, enabled, connect, cleanup]);

  return {
    odds,
    loading,
    error,
    connected,
    reconnect,
  };
}

/**
 * Polling-based fallback for platforms without EventSource support.
 * Uses regular HTTP polling at the specified interval.
 *
 * @param pollId - The prediction market poll ID
 * @param intervalMs - Polling interval in milliseconds (default: 5000)
 * @param enabled - Whether to enable polling (default: true)
 */
export function usePredictionOddsPolling(
  pollId: string | null,
  intervalMs: number = 5000,
  enabled: boolean = true
): UsePredictionOddsResult {
  const [odds, setOdds] = useState<LiveOddsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOdds = useCallback(async () => {
    if (!pollId || !mountedRef.current) return;

    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/v1/predictions/${encodeURIComponent(pollId)}/pool`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!mountedRef.current) return;

      setOdds({
        yesOdds: data.yesOdds ?? 1,
        noOdds: data.noOdds ?? 1,
        yesPct: data.yesPct ?? 50,
        noPct: data.noPct ?? 50,
        totalPoolSkr: data.totalPoolSkr ?? 0,
        yesPoolSkr: data.yesPoolSkr ?? 0,
        noPoolSkr: data.noPoolSkr ?? 0,
        totalStakers: data.totalStakers ?? 0,
        updatedAt: data.updatedAt ?? new Date().toISOString(),
      });
      setError(null);
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError("Failed to fetch odds");
      setLoading(false);
    }
  }, [pollId]);

  const reconnect = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchOdds();
  }, [fetchOdds]);

  useEffect(() => {
    mountedRef.current = true;

    if (pollId && enabled) {
      void fetchOdds();

      intervalRef.current = setInterval(() => {
        void fetchOdds();
      }, intervalMs);
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pollId, enabled, intervalMs, fetchOdds]);

  return {
    odds,
    loading,
    error,
    connected: !loading && !error,
    reconnect,
  };
}
