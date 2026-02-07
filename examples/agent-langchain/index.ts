import { AgentGate } from "@agentgate/sdk";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

/**
 * LangChain + AgentGate integration example.
 *
 * This demonstrates how to wrap AgentGate-enabled services as LangChain
 * tools so that an LLM agent can autonomously discover, register with,
 * and call external APIs — all without browser automation.
 *
 * Flow:
 *   1. AgentGate SDK connects to a service (discover -> register -> verify)
 *   2. The session is wrapped as a LangChain DynamicStructuredTool
 *   3. A LangChain agent uses the tool to answer user questions
 */

async function main() {
  // ---------------------------------------------------------------
  // Step 1: Connect to AgentGate-enabled services
  // ---------------------------------------------------------------
  const agent = new AgentGate({
    keyPath: "./agent-keys.json",
    metadata: {
      framework: "langchain",
      version: "0.3.0",
      name: "weather-research-agent",
    },
  });

  // Connect to a weather API. The SDK handles discovery, registration,
  // and credential caching automatically.
  const weatherSession = await agent.connect("http://localhost:3000");
  console.log(`Connected to Weather API as agent ${weatherSession.agentId}`);

  // ---------------------------------------------------------------
  // Step 2: Wrap AgentGate sessions as LangChain tools
  // ---------------------------------------------------------------

  const getWeatherTool = new DynamicStructuredTool({
    name: "get_current_weather",
    description:
      "Get the current weather for a city. Returns temperature, condition, and humidity.",
    schema: z.object({
      city: z
        .string()
        .describe(
          "The city to get weather for, using kebab-case (e.g. san-francisco, new-york)"
        ),
    }),
    func: async ({ city }) => {
      try {
        const response = await weatherSession.get("/api/weather", {
          params: { city },
        });
        return JSON.stringify(response.data);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return JSON.stringify({ error: message });
      }
    },
  });

  const getForecastTool = new DynamicStructuredTool({
    name: "get_weather_forecast",
    description:
      "Get a multi-day weather forecast for a city. Returns daily high/low temperatures and conditions.",
    schema: z.object({
      city: z
        .string()
        .describe(
          "The city to get a forecast for, using kebab-case (e.g. san-francisco, new-york)"
        ),
      days: z
        .number()
        .min(1)
        .max(14)
        .default(7)
        .describe("Number of days to forecast (1-14)"),
    }),
    func: async ({ city, days }) => {
      try {
        const response = await weatherSession.get("/api/forecast", {
          params: { city, days: String(days) },
        });
        return JSON.stringify(response.data);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return JSON.stringify({ error: message });
      }
    },
  });

  // ---------------------------------------------------------------
  // Step 3: Create a LangChain agent with the AgentGate tools
  // ---------------------------------------------------------------

  const llm = new ChatOpenAI({
    modelName: "gpt-4o",
    temperature: 0,
    // Set OPENAI_API_KEY in your environment
  });

  const tools = [getWeatherTool, getForecastTool];

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are a helpful weather research assistant. You have access to a
real-time weather API through AgentGate. Use the available tools to answer
questions about current weather and forecasts. Always provide specific data
from the API rather than making assumptions. Available cities include:
san-francisco, new-york, austin, london, and tokyo.`,
    ],
    ["human", "{input}"],
    ["placeholder", "{agent_scratchpad}"],
  ]);

  const langchainAgent = await createOpenAIFunctionsAgent({
    llm,
    tools,
    prompt,
  });

  const executor = new AgentExecutor({
    agent: langchainAgent,
    tools,
    verbose: true, // Set to false in production
  });

  // ---------------------------------------------------------------
  // Step 4: Run the agent with a natural language query
  // ---------------------------------------------------------------

  console.log("\n--- Running LangChain Agent ---\n");

  const result = await executor.invoke({
    input:
      "What's the weather like in San Francisco right now? Also, give me a 5-day forecast for Austin.",
  });

  console.log("\n--- Agent Response ---\n");
  console.log(result.output);

  // ---------------------------------------------------------------
  // Example: Connecting to multiple services
  // ---------------------------------------------------------------
  //
  // You can connect to any number of AgentGate-enabled services and
  // wrap each as LangChain tools. The agent can then autonomously
  // decide which APIs to call based on the user's question.
  //
  // const stockSession = await agent.connect("http://localhost:3001");
  //
  // const getStockTool = new DynamicStructuredTool({
  //   name: "get_stock_price",
  //   description: "Get current stock price for a given symbol",
  //   schema: z.object({
  //     symbol: z.string().describe("Stock ticker symbol (e.g. AAPL, GOOGL)"),
  //   }),
  //   func: async ({ symbol }) => {
  //     const response = await stockSession.get("/api/stocks", {
  //       params: { symbol },
  //     });
  //     return JSON.stringify(response.data);
  //   },
  // });
  //
  // // Add stockTools to the agent and it can answer questions like:
  // // "Is it a good day for outdoor activities in SF? Also, how's AAPL doing?"
}

main().catch((error) => {
  console.error("Agent error:", error.message);
  process.exit(1);
});
