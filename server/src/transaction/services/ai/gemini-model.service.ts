import { Injectable } from '@nestjs/common';
import { AIModelService, TransactionAnalysisResult } from './ai-model.interface';
import { ConfigService } from '@nestjs/config';
import { AI_CONFIG } from './ai-config';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

@Injectable()
export class GeminiModelService implements AIModelService {
  private model;
  private generativeAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    this.generativeAI = new GoogleGenerativeAI(apiKey);
    this.model = this.generativeAI.getGenerativeModel({
      model: AI_CONFIG.gemini.modelName,
      generationConfig: {
        temperature: AI_CONFIG.gemini.temperature,
        maxOutputTokens: AI_CONFIG.gemini.maxOutputTokens,
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });
  }

  async analyzeMaliciousTransaction(
    transactionData: {
      from: string;
      to: string;
      value: string;
      data?: string;
      timestamp: number;
      internalTransactions?: Array<{
        from: string;
        to: string;
        value: string;
        data?: string;
      }>;
    },
    context?: {
      previousTransactions?: any[];
      accountInfo?: any;
      safeAddress?: string;
    }
  ): Promise<TransactionAnalysisResult> {
    try {
      // KNOWN SUSPICIOUS ADDRESSES - Auto-flag these
      const suspiciousAddresses = [
        '0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c', // Test address
        // Add more known scam addresses here
      ];
      
      // Auto-flag transactions with suspicious addresses
      if (transactionData.to && suspiciousAddresses.includes(transactionData.to.toLowerCase())) {
        return {
          isMalicious: true,
          confidence: 0.99,
          reason: "This address is associated with known scams or suspicious activity."
        };
      }
      
      // SPAM TOKEN DETECTION - Refined for Safe wallet transactions
      // Note: Safe wallets commonly have legitimate 0 ETH value transactions for contract calls
      const isLikelySpamToken = transactionData.data?.includes('0xa9059cbb') && 
                               transactionData.value === '0' && 
                               (!context?.safeAddress || // Not from a known Safe wallet
                                transactionData.data.includes('spam') || // Contains explicit spam indicators
                                transactionData.data.includes('airdrop'));
      
      const hasSpamKeywords = transactionData.data && (
        transactionData.data.toLowerCase().includes('airdrop') ||
        transactionData.data.toLowerCase().includes('claim') ||
        (transactionData.data.toLowerCase().includes('mint') && 
         transactionData.value === '0' && 
         !transactionData.data.toLowerCase().includes('multisig')) // Exclude multisig operations
      );
      
      if (isLikelySpamToken || hasSpamKeywords) {
        return {
          isMalicious: true,
          confidence: 0.9,
          reason: "Detected potential spam token transaction. This appears to be an airdrop or unsolicited token transfer commonly associated with scams."
        };
      }

      // Check if we have any internal transactions to analyze
      const hasInternalTxs = transactionData.internalTransactions && 
                            transactionData.internalTransactions.length > 0;
      
      // Prepare internal transaction summary for the main prompt
      let internalTxSummary = "";
      if (hasInternalTxs) {
        const relevantInternalTxs = transactionData.internalTransactions!
          .filter(tx => 
            // Only analyze internal txs related to the safe wallet
            context?.safeAddress && 
            (tx.from.toLowerCase() === context.safeAddress.toLowerCase() || 
             tx.to.toLowerCase() === context.safeAddress.toLowerCase())
          );
        
        if (relevantInternalTxs.length > 0) {
          internalTxSummary = "Internal Transactions:\n" + 
            relevantInternalTxs.map((tx, idx) => 
              `${idx+1}. From: ${tx.from} To: ${tx.to} Value: ${tx.value}`
            ).join("\n");
        }
      }

      // SIMPLIFIED PROMPT - More direct instructions
      const prompt = `
You are analyzing blockchain transactions to identify malicious activity.

IMPORTANT: This is a Safe (formerly Gnosis Safe) smart contract wallet transaction. Safe wallets commonly have:
- 0 ETH value transactions for contract calls, which are typically legitimate
- Multiple internal transactions as part of normal multisig operations
- Contract interactions that are part of normal wallet operation

Main transaction details:
- From: ${transactionData.from || 'Unknown'}
- To: ${transactionData.to || 'Unknown'}
- Value: ${transactionData.value || '0'}
- Data: ${transactionData.data?.substring(0, 200) || 'No data'}

${internalTxSummary}

Classify this as MALICIOUS only if it shows obvious suspicious patterns such as:
1. Unsolicited token transfers or airdrops that are clearly not requested by the user
2. Unusual or excessive approval requests (especially for all tokens)
3. Interactions with known scam contracts
4. Unusual transfers to previously unused addresses
5. Contract calls that appear to drain funds
6. Phishing attempts via token approvals
7. Spam tokens with no legitimate use case

For Safe wallets, do NOT flag normal operations like:
- Regular contract interactions with 0 ETH value
- Multisig transaction executions
- Token transfers initiated by the wallet owner
- DeFi protocol interactions

FORMAT INSTRUCTIONS:
- Return ONLY a raw JSON object without markdown formatting (no \`\`\` tags)
- Do not include any explanation text before or after the JSON object
- Use exactly this format:

{
  "isMalicious": false,
  "confidence": 0.5,
  "reason": "your analysis reason here"
}
      `;

      // Make the API request with retry logic
      let text;
      let retryCount = 0;
      const maxRetries = 2;
      
      while (retryCount <= maxRetries) {
        try {
          const result = await this.model.generateContent(prompt);
          const response = await result.response;
          text = response.text().trim();
          
          // Check for common patterns that indicate a valid response
          const hasJsonBlock = text.includes('```json') && text.includes('```');
          const hasJsonObject = text.includes('{') && text.includes('}');
          
          if (hasJsonObject || hasJsonBlock) {
            break; // Got what seems to be valid JSON, exit retry loop
          }
          
          // If we're here, the response doesn't look like JSON
          console.log(`Attempt ${retryCount + 1}: Response doesn't contain JSON, retrying...`);
          retryCount++;
          
          if (retryCount <= maxRetries) {
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`API request error on attempt ${retryCount + 1}:`, error);
          retryCount++;
          
          if (retryCount <= maxRetries) {
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            // Max retries reached, propagate the error
            throw error;
          }
        }
      }
      
      // Log raw response for debugging
      console.log("Raw Gemini response:", text);

      // First, analyze main transaction
      let mainAnalysis: TransactionAnalysisResult;
      
      // Extract and parse the JSON response
      try {
        // Clean the response to handle formatting issues
        let cleanedText = text;
        
        // Remove markdown code blocks if present (```json...```)
        if (cleanedText.includes('```')) {
          // This regex extracts content between markdown code fences
          const codeBlockMatch = cleanedText.match(/```(?:json)?\n?([\s\S]*?)```/);
          if (codeBlockMatch && codeBlockMatch[1]) {
            cleanedText = codeBlockMatch[1].trim();
          } else {
            // Fallback: just remove the markdown markers
            cleanedText = cleanedText.replace(/```json|```/g, '').trim();
          }
        }
        
        // If still no clean JSON, extract anything between { and }
        if (!cleanedText.startsWith('{') || !cleanedText.endsWith('}')) {
          const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            cleanedText = jsonMatch[0].trim();
          }
        }
        
        console.log("Cleaned JSON text:", cleanedText);
        
        // Try parsing the cleaned JSON
        const parsedJson = JSON.parse(cleanedText);
        console.log("Successfully parsed JSON:", parsedJson);
        
        // Return the actual AI analysis
        mainAnalysis = {
          isMalicious: Boolean(parsedJson.isMalicious),
          confidence: Number(parsedJson.confidence) || 0.5,
          reason: parsedJson.reason || "Analysis completed based on transaction properties."
        };
      } catch (parseError) {
        console.error("Failed to parse JSON response:", parseError);
        
        // If we can't parse JSON at all, default to non-malicious for Safe wallet transactions
        // This is safer than falsely flagging legitimate transactions
        mainAnalysis = {
          isMalicious: false,
          confidence: 0.3,
          reason: "Unable to analyze transaction due to AI model response format issues. Treating as legitimate transaction."
        };
      }
      
      // Now, analyze any internal transactions if present and add them to the result
      if (hasInternalTxs && context?.safeAddress) {
        const relevantInternalTxs = transactionData.internalTransactions!.filter(tx => 
          tx.from.toLowerCase() === context.safeAddress!.toLowerCase() || 
          tx.to.toLowerCase() === context.safeAddress!.toLowerCase()
        );
        
        if (relevantInternalTxs.length > 0) {
          // If any internal tx is to a known suspicious address, mark it immediately
          const internalAnalysis = relevantInternalTxs.map(tx => {
            // Check if this internal tx is to/from a suspicious address
            const isToSuspicious = suspiciousAddresses.includes(tx.to.toLowerCase());
            const isFromSuspicious = suspiciousAddresses.includes(tx.from.toLowerCase());
            
            if (isToSuspicious || isFromSuspicious) {
              return {
                isMalicious: true,
                confidence: 0.95,
                reason: `Internal transaction ${isToSuspicious ? 'to' : 'from'} a known suspicious address.`,
                transaction: {
                  from: tx.from,
                  to: tx.to,
                  value: tx.value
                }
              };
            }
            
            // Otherwise, inherit the main transaction's analysis for simplicity
            // In a production system, you might want to analyze each internal tx separately
            return {
              isMalicious: mainAnalysis.isMalicious,
              confidence: mainAnalysis.confidence,
              reason: `Internal transaction associated with ${mainAnalysis.isMalicious ? 'suspicious' : 'legitimate'} main transaction.`,
              transaction: {
                from: tx.from,
                to: tx.to,
                value: tx.value
              }
            };
          });
          
          // Add internal transaction analysis to the result
          mainAnalysis.internalTransactions = internalAnalysis;
          
          // If any internal transaction is malicious, the whole transaction should be considered malicious
          const anyInternalMalicious = internalAnalysis.some(tx => tx.isMalicious);
          if (anyInternalMalicious && !mainAnalysis.isMalicious) {
            mainAnalysis.isMalicious = true;
            mainAnalysis.confidence = Math.max(...internalAnalysis.map(tx => tx.confidence));
            mainAnalysis.reason = "Transaction contains suspicious internal operations.";
          }
        }
      }
      
      return mainAnalysis;
      
    } catch (error) {
      console.error('Error analyzing transaction with Gemini:', error);
      // When there's an error calling the LLM model, ignore the analysis and display the transaction as normal
      return {
        isMalicious: false, // Always show as normal transaction when there's an error
        confidence: 0,
        reason: 'AI analysis skipped due to service error.',
      };
    }
  }
} 