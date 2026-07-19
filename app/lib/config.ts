export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
export const FULLTIME_PROGRAM_ID =
  process.env.NEXT_PUBLIC_FULLTIME_PROGRAM_ID ?? "6Aow8DZvpWFPrKYf1tUU2WsSXuFF36iNyh4rJegp62M9";
export const ORACLE_PROGRAM_ID =
  process.env.NEXT_PUBLIC_ORACLE_PROGRAM_ID ?? "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
export const DEMO_MINT = process.env.NEXT_PUBLIC_DEMO_MINT ?? "";
export const EXPLORER = (sig: string, type: "tx" | "address" = "tx") =>
  `https://explorer.solana.com/${type === "tx" ? "tx" : "address"}/${sig}?cluster=devnet`;
