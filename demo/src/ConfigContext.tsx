import { createContext, useContext, useState, type ReactNode } from "react";

export interface AppConfig {
  rpcUrl: string;
  mintAddress: string;
  tokenProgram: "spl-token-2022" | "spl-token";
  hookProgramId: string;
  backendUrl: string;
}

const DEFAULT: AppConfig = {
  rpcUrl: "https://api.devnet.solana.com",
  mintAddress: "",
  tokenProgram: "spl-token-2022",
  hookProgramId: "",
  backendUrl: "http://localhost:3000",
};

interface Ctx {
  config: AppConfig;
  setConfig: (update: Partial<AppConfig>) => void;
}

const ConfigContext = createContext<Ctx>({
  config: DEFAULT,
  setConfig: () => {},
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, _setConfig] = useState<AppConfig>(() => {
    try {
      const stored = localStorage.getItem("sss-demo-config");
      return stored ? { ...DEFAULT, ...JSON.parse(stored) } : DEFAULT;
    } catch {
      return DEFAULT;
    }
  });

  function setConfig(update: Partial<AppConfig>) {
    _setConfig((prev) => {
      const next = { ...prev, ...update };
      localStorage.setItem("sss-demo-config", JSON.stringify(next));
      return next;
    });
  }

  return (
    <ConfigContext.Provider value={{ config, setConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useAppConfig() {
  return useContext(ConfigContext);
}
