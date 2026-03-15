declare module '@solana/web3.js' {
  export class PublicKey {
    constructor(value: string | Uint8Array | number[]);
    toString(): string;
  }
  export class Transaction {
    add(...args: any[]): void;
  }
}

declare module '@solana/spl-token' {
  import { PublicKey } from '@solana/web3.js';
  export function createTransferInstruction(source: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint): any;
  export function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve?: boolean): Promise<PublicKey>;
}
