import { Controller, Get, Param, Query, Logger, BadRequestException, InternalServerErrorException, UseInterceptors } from '@nestjs/common';
import { TokenService, TokenInfo } from './token.service';
import { ethers } from 'ethers';
import { ConfigService } from '@nestjs/config';
import { BigIntSerializerInterceptor } from './interceptors/bigint-serializer.interceptor';

@Controller('tokens')
@UseInterceptors(BigIntSerializerInterceptor)
export class TokenController {
  private readonly logger = new Logger(TokenController.name);
  private readonly providers: Map<number, ethers.JsonRpcProvider> = new Map();
  
  constructor(
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
  ) {
    // Initialize providers for supported networks
    this.initializeProviders();
  }

  private initializeProviders(): void {
    try {
      // Configure providers for each supported network
      // You can load these from environment variables or config
      const networks = [
        { 
          chainId: 1, 
          rpcUrl: this.configService.get<string>('MAINNET_RPC_URL', 'https://eth.llamarpc.com') 
        },
        { 
          chainId: 5, 
          rpcUrl: this.configService.get<string>('GOERLI_RPC_URL', 'https://ethereum-goerli.publicnode.com') 
        },
        { 
          chainId: 11155111, 
          rpcUrl: this.configService.get<string>('SEPOLIA_RPC_URL', 'https://ethereum-sepolia.publicnode.com') 
        },
      ];
      
      for (const network of networks) {
        try {
          this.logger.log(`Initializing provider for chain ID ${network.chainId} with RPC URL: ${network.rpcUrl}`);
          const provider = new ethers.JsonRpcProvider(network.rpcUrl);
          provider.pollingInterval = 15000;
          this.providers.set(network.chainId, provider);
          this.logger.log(`Successfully initialized provider for chain ID ${network.chainId}`);
        } catch (error) {
          this.logger.error(`Failed to initialize provider for chain ID ${network.chainId}: ${error.message}`);
        }
      }
      
      this.logger.log(`Initialized ${this.providers.size} providers`);
    } catch (error) {
      this.logger.error(`Error in provider initialization: ${error.message}`);
    }
  }

  // Simple health check endpoint - must be before the :address pattern route
  @Get('health')
  async healthCheck(): Promise<{ status: string; uptime: number; timestamp: string }> {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':address')
  async getTokenBalances(
    @Param('address') address: string,
    @Query('chainId') chainIdStr: string,
  ): Promise<TokenInfo[]> {
    try {
      // Validate address format
      if (!ethers.isAddress(address)) {
        throw new BadRequestException('Invalid Ethereum address format');
      }
      
      // Validate chain ID
      const chainId = parseInt(chainIdStr);
      if (isNaN(chainId)) {
        throw new BadRequestException('Invalid chain ID');
      }

      this.logger.log(`Fetching token balances for address ${address} on chain ID ${chainId}`);

      // For all networks, use the regular provider handling
      // Get provider for the requested chain ID
      const provider = this.providers.get(chainId);
      if (!provider) {
        this.logger.warn(`No provider available for chain ID ${chainId}`);
        
        // Try to create a provider on-demand if it wasn't initialized
        try {
          let rpcUrl: string;
          switch (chainId) {
            case 1:
              rpcUrl = this.configService.get<string>('MAINNET_RPC_URL', 'https://eth.llamarpc.com');
              break;
            case 5:
              rpcUrl = this.configService.get<string>('GOERLI_RPC_URL', 'https://ethereum-goerli.publicnode.com');
              break;
            case 11155111:
              rpcUrl = this.configService.get<string>('SEPOLIA_RPC_URL', 'https://ethereum-sepolia.publicnode.com');
              break;
            default:
              throw new BadRequestException(`Chain ID ${chainId} is not supported. Supported networks: 1, 5, 11155111`);
          }
          
          this.logger.log(`Creating on-demand provider for chain ID ${chainId} with RPC URL: ${rpcUrl}`);
          const onDemandProvider = new ethers.JsonRpcProvider(rpcUrl);
          this.providers.set(chainId, onDemandProvider);
          return await this.getTokenBalancesWithProvider(onDemandProvider, address, chainId);
        } catch (error) {
          this.logger.error(`Failed to create on-demand provider for chain ID ${chainId}: ${error.message}`);
          throw new BadRequestException(`Chain ID ${chainId} is not supported. Supported networks: ${[...this.providers.keys()].join(', ')}`);
        }
      }
      
      return await this.getTokenBalancesWithProvider(provider, address, chainId);
    } catch (error) {
      this.logger.error(`Error fetching token balances: ${error.message}`, error.stack);
      
      // Re-throw NestJS exceptions as is
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      
      // Convert other errors to InternalServerErrorException
      throw new InternalServerErrorException(
        `Error fetching token balances: ${error.message || 'Unknown error'}`
      );
    }
  }
  
  // Helper method to get token balances with a provider
  private async getTokenBalancesWithProvider(
    provider: ethers.JsonRpcProvider,
    address: string,
    chainId: number
  ): Promise<TokenInfo[]> {
    // Verify connectivity with a retry mechanism
    let connected = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!connected && retryCount < maxRetries) {
      try {
        // Try to get network to verify connection
        const detectedNetwork = await provider.getNetwork();
        connected = true;
        this.logger.log(`Connected to network: ${detectedNetwork.name} (${detectedNetwork.chainId})`);
      } catch (error) {
        retryCount++;
        if (retryCount < maxRetries) {
          this.logger.warn(`Failed to connect to provider for chain ID ${chainId}, retrying (${retryCount}/${maxRetries})...`);
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        } else {
          throw new InternalServerErrorException(
            `Failed to connect to blockchain node for chain ID ${chainId} after ${maxRetries} attempts. ` +
            `The node may be down or unavailable.`
          );
        }
      }
    }
    
    // Get token balances
    try {
      const balances = await this.tokenService.getTokenBalances(
        provider,
        address,
        chainId,
      );
      
      return balances;
    } catch (error) {
      this.logger.error(`Error in tokenService.getTokenBalances: ${error.message}`);
      throw error;
    }
  }
} 