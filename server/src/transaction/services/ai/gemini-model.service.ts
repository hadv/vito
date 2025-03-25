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
    },
    context?: {
      previousTransactions?: any[];
      accountInfo?: any;
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
      
      // SPAM TOKEN DETECTION
      const isZeroValueTokenTransfer = transactionData.data?.includes('0xa9059cbb') && transactionData.value === '0';
      const hasSpamKeywords = transactionData.data && (
        transactionData.data.toLowerCase().includes('airdrop') ||
        transactionData.data.toLowerCase().includes('claim') ||
        (transactionData.data.toLowerCase().includes('mint') && transactionData.value === '0')
      );
      
      if (isZeroValueTokenTransfer || hasSpamKeywords) {
        return {
          isMalicious: true,
          confidence: 0.9,
          reason: "Detected potential spam token transaction. This appears to be an airdrop or unsolicited token transfer commonly associated with scams."
        };
      }

      // SIMPLIFIED PROMPT - More direct instructions
      const prompt = `
You are analyzing blockchain transactions to identify malicious activity. THIS IS SECURITY CRITICAL.

ATTENTION: By default, you should consider transactions suspicious unless they are clearly legitimate.

Transaction details:
- From: ${transactionData.from || 'Unknown'}
- To: ${transactionData.to || 'Unknown'}
- Value: ${transactionData.value || '0'}
- Data: ${transactionData.data?.substring(0, 200) || 'No data'}

Classify this as MALICIOUS if it shows ANY of these patterns:
1. Unsolicited token transfers or airdrops (especially with 0 ETH value)
2. Requests for token approvals
3. Interactions with unverified contracts
4. High-value transfers to unknown addresses
5. Smart contract calls that could drain funds
6. Phishing attempts through token interactions
7. Any transaction that seems unusual or suspicious
8. Worthless token transfers (spam tokens)

Return ONLY a valid JSON with this format:
{
  "isMalicious": boolean,
  "confidence": number,
  "reason": "string"
}
      `;

      // Make the API request
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      // Override for testing - log raw response
      console.log("Raw Gemini response:", text);

      // Try several approaches to extract valid JSON
      try {
        // First attempt: Try parsing the entire response as JSON
        const parsedJson = JSON.parse(text);
        console.log("Success parsing JSON directly:", parsedJson);
        
        // Return the actual AI analysis
        return {
          isMalicious: Boolean(parsedJson.isMalicious),
          confidence: Number(parsedJson.confidence) || 0.5,
          reason: parsedJson.reason || "Analysis completed based on transaction properties."
        };
      } catch (parseError) {
        console.log("First parse attempt failed, trying to extract JSON from text");
        
        // Second attempt: Try to extract JSON using regex
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const extractedJson = JSON.parse(jsonMatch[0]);
            console.log("Extracted JSON via regex:", extractedJson);
            
            return {
              isMalicious: Boolean(extractedJson.isMalicious),
              confidence: Number(extractedJson.confidence) || 0.5,
              reason: extractedJson.reason || "Analysis completed based on transaction data."
            };
          } catch (innerParseError) {
            console.error("Failed to parse extracted JSON:", innerParseError);
          }
        }
        
        // Third attempt: If we can't parse JSON, look for indications in the text
        console.error("JSON extraction failed, analyzing raw text");
        const lowerText = text.toLowerCase();
        const isMalicious = lowerText.includes('malicious') || 
                           lowerText.includes('suspicious') || 
                           lowerText.includes('spam') || 
                           lowerText.includes('phishing') ||
                           lowerText.includes('risk') ||
                           lowerText.includes('harmful') ||
                           lowerText.includes('scam');
        
        return {
          isMalicious: isMalicious,
          confidence: 0.6,
          reason: "Based on text analysis, transaction " + 
                 (isMalicious ? "shows suspicious patterns." : "appears legitimate.")
        };
      }
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