/**
 * Format signatures for the Safe contract by concatenating them with proper 0x prefixing
 * @param signatures Array of signatures to format
 * @returns Concatenated signature string
 */
export function formatSafeSignatures(signatures: string[]): string {
  if (signatures.length === 0) return '0x';

  // For a single signature, just return it as is (ensuring 0x prefix)
  if (signatures.length === 1) {
    const sig = signatures[0];
    return sig.startsWith('0x') ? sig : `0x${sig}`;
  }

  // For multiple signatures, concatenate them
  // First signature keeps the 0x prefix, others don't
  let result = signatures[0].startsWith('0x') ? signatures[0] : `0x${signatures[0]}`;

  // Add the rest without the 0x prefix
  for (let i = 1; i < signatures.length; i++) {
    const sig = signatures[i];
    result += sig.startsWith('0x') ? sig.slice(2) : sig;
  }

  return result;
}