interface Command {
  cmd: string;
  desc: string;
}

export const COMMANDS: Command[] = [
  { cmd: ':c', desc: 'Connect a Safe wallet' },
  { cmd: ':i', desc: 'Display Safe information' },
  { cmd: ':wc', desc: 'Connect a signer wallet via WalletConnect' },
  { cmd: ':dc', desc: 'Disconnect the current signer wallet' },
  { cmd: ':t', desc: 'Create a new transaction' },
  { cmd: ':l', desc: 'List pending transactions' },
  { cmd: ':q', desc: 'Clear the buffer screen' },
  { cmd: ':d', desc: 'Disconnect the Safe wallet' },
  { cmd: ':h', desc: 'Show this help guide' },
]; 