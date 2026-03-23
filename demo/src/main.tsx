import React, { useMemo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";
import App from "./App";
import { ConfigProvider, useAppConfig } from "./ConfigContext";

function SolanaProviders({ children }: { children: ReactNode }) {
  const { config } = useAppConfig();
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={config.rpcUrl}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider>
      <SolanaProviders>
        <App />
      </SolanaProviders>
    </ConfigProvider>
  </React.StrictMode>,
);
