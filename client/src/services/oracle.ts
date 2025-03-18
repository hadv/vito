import { ethers } from 'ethers';

export class PriceOracle {
  // Uniswap V3 ETH/USDC pool addresses for different networks
  private static readonly UNISWAP_V3_POOLS: Record<number, string> = {
    1: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', // Ethereum mainnet
    10: '0x85149247691df622eaf1a8bd0cafd40a451c5718', // Optimism
    42161: '0xc31a54dab5850e57e750c108033e3beff1a5b5dd', // Arbitrum
    137: '0x45dda9cb7c25131df268515131f647d726f50608', // Polygon
  };

  /**
   * Fetches the current ETH price in USD from Uniswap V3 ETH/USDC pool
   * Falls back to CoinGecko if Uniswap fails or network is not supported
   * @param provider The ethers provider to use for the blockchain calls
   * @returns The current ETH price in USD
   */
  public static async getEthPrice(provider: ethers.JsonRpcProvider): Promise<number> {
    try {
      // Get the network chain ID
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);

      // Check if we have a Uniswap V3 pool for this network
      const poolAddress = this.UNISWAP_V3_POOLS[chainId];
      if (!poolAddress) {
        throw new Error(`No Uniswap V3 pool configured for chain ID ${chainId}`);
      }
      
      // ABI for just the slot0 function which gives us the current price
      const uniswapV3PoolABI = [
        'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
      ];
      
      // Create contract instance
      const poolContract = new ethers.Contract(
        poolAddress,
        uniswapV3PoolABI,
        provider
      );
      
      // Get the current price data from slot0
      const slot0Data = await poolContract.slot0();
      
      // Extract the sqrtPriceX96 value
      const sqrtPriceX96 = slot0Data[0];
      
      // Convert sqrtPriceX96 to price
      // For ETH/USDC, we need to convert it to USDC price (considering decimals)
      // ETH has 18 decimals, USDC has 6 decimals
      // Formula: price = (sqrtPriceX96 / 2^96)^2 * (10^token1Decimals / 10^token0Decimals)
      const price = Number(
        (BigInt(sqrtPriceX96.toString()) * BigInt(sqrtPriceX96.toString())) / 
        (BigInt(2) ** BigInt(192)) * 
        BigInt(10 ** (6 - 18)) / 
        BigInt(1)
      );
      
      // USDC/ETH price (how many USDC for 1 ETH)
      // We need to use 1/price because our pool gives USDC price in terms of ETH
      const ethPriceInUsdc = 1 / price;
      
      return ethPriceInUsdc;
    } catch (error) {
      console.error('Error fetching ETH price from Uniswap:', error);
      
      // Fallback to a secondary source if Uniswap fails
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const data = await response.json();
        return data.ethereum.usd;
      } catch (secondaryError) {
        console.error('Error fetching from fallback source:', secondaryError);
        return 2500; // Default fallback price
      }
    }
  }
} 