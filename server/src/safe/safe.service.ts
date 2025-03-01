import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ethers } from 'ethers';
import { firstValueFrom } from 'rxjs';
import { SignClient } from '@walletconnect/sign-client';
import { ConfigService } from '@nestjs/config';
import { CreateSafeTxDto } from './safe.dto';

@Injectable()
export class SafeService {
  private wcClient: any;
  private provider: ethers.JsonRpcProvider;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const rpcUrl = this.configService.get<string>('RPC_URL');
    if (!rpcUrl) throw new Error('RPC_URL not configured in environment variables');
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.initWalletConnect();
  }

  async initWalletConnect(): Promise<void> {
    this.wcClient = await SignClient.init({
      projectId: this.configService.get<string>('WALLETCONNECT_PROJECT_ID'),
      metadata: {
        name: 'Vim Safe App',
        description: 'Safe Transaction App with Vim UI',
        url: 'http://localhost:3000',
        icons: ['https://walletconnect.com/walletconnect-logo.png'],
      },
    });
  }

  async connectWallet(): Promise<{ uri: string; approval: () => Promise<any> }> {
    const { uri, approval } = await this.wcClient.connect({
      requiredNamespaces: {
        eip155: {
          methods: ['eth_signTypedData_v4'],
          chains: ['eip155:1'],
          events: ['chainChanged', 'accountsChanged'],
        },
      },
    });
    return { uri, approval };
  }

  async getSafeInfo(safeAddress: string): Promise<any> {
    console.log('Fetching Safe info via RPC for:', safeAddress);
    try {
      const safeAbi = [
        'function getOwners() view returns (address[] memory)',
        'function getThreshold() view returns (uint256)',
        'function nonce() view returns (uint256)',
      ];
      const safeContract = new ethers.Contract(safeAddress, safeAbi, this.provider);

      const owners = await safeContract.getOwners();
      const threshold = await safeContract.getThreshold();

      const safeInfo = {
        address: safeAddress,
        owners: owners.map((owner: string) => owner.toLowerCase()),
        threshold: Number(threshold),
      };

      console.log('Safe RPC response:', safeInfo);
      return safeInfo;
    } catch (error) {
      console.error('Safe RPC error:', error.message);
      throw error;
    }
  }

  async sendSafeTransaction(safeAddress: string, txData: CreateSafeTxDto, signerAddress: string): Promise<any> {
    const safeAbi = [
      'function nonce() view returns (uint256)',
    ];
    const safeContract = new ethers.Contract(safeAddress, safeAbi, this.provider);
    const nonce = await safeContract.nonce();

    const safeTx = {
      to: txData.to,
      value: txData.value,
      data: txData.data || '0x',
      operation: txData.operation || 0,
      safeTxGas: 0,
      baseGas: 0,
      gasPrice: 0,
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      nonce: Number(nonce),
    };

    const domain = {
      verifyingContract: safeAddress,
      chainId: 1,
    };
    const types = {
      SafeTx: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'nonce', type: 'uint256' },
      ],
    };
    const message = safeTx;

    const signature = await this.wcClient.request({
      topic: this.wcClient.session.values[0].topic,
      chainId: 'eip155:1',
      request: {
        method: 'eth_signTypedData_v4',
        params: [signerAddress, JSON.stringify({ domain, types, message })],
      },
    });

    const safeTxHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256', 'bytes', 'uint8', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256'],
        [
          safeTx.to,
          safeTx.value,
          safeTx.data,
          safeTx.operation,
          safeTx.safeTxGas,
          safeTx.baseGas,
          safeTx.gasPrice,
          safeTx.gasToken,
          safeTx.refundReceiver,
          safeTx.nonce,
        ],
      ),
    );

    const response = await firstValueFrom(
      this.httpService.post(
        `https://safe-transaction-mainnet.safe.global/api/v1/safes/${safeAddress}/multisig-transactions/`,
        {
          ...safeTx,
          contractTransactionHash: safeTxHash,
          sender: signerAddress,
          signature,
        },
      ),
    );

    return response.data;
  }
}
