import {
  AgentResult,
  anthropic,
  createAgent,
  createNetwork,
  createRoutingAgent,
  createState,
  createTool,
  gemini,
  HistoryConfig,
} from "@inngest/agent-kit";
import { z } from "zod";
import { inngest } from "./inngest";

const conversationHistoryAdapter: HistoryConfig<any> = {
  createThread: async ({ state }) => {
    // create new thread
  },

  get: async ({ threadId }) => {
    // query the db for the chat history per thread
  },

  appendResults: async ({
    threadId,
    newResults,
    userMessage,
    step,
    network,
  }) => {
    // add the message to the db, see agent kit docs for more details
  },
};

export const state = createState<{
  meetResults?: any[];
  userId?: string;
  threadId?: string;
  messageId?: string;
}>();

const allColumns = [
  "Name",
  "Sex",
  "Event",
  "Equipment",
  "Age",
  "AgeClass",
  "BirthYearClass",
  "Division",
  "BodyweightKg",
  "WeightClassKg",
  "Squat1Kg",
  "Squat2Kg",
  "Squat3Kg",
  "Squat4Kg",
  "Best3SquatKg",
  "Bench1Kg",
  "Bench2Kg",
  "Bench3Kg",
  "Bench4Kg",
  "Best3BenchKg",
  "Deadlift1Kg",
  "Deadlift2Kg",
  "Deadlift3Kg",
  "Deadlift4Kg",
  "Best3DeadliftKg",
  "TotalKg",
  "Place",
  "Dots",
  "Wilks",
  "Glossbrenner",
  "Goodlift",
  "Tested",
  "Country",
  "State",
  "Federation",
  "ParentFederation",
  "Date",
  "MeetCountry",
  "MeetState",
  "MeetTown",
  "MeetName",
  "Sanctioned",
] as const;

export const agentFunction = inngest.createFunction(
  { id: "cathy-agent-function" },
  { event: "agent-kit" },
  async ({ event }) => {
    const { input, threadId, userId, messageId } = event.data as {
      input: string;
      threadId: string;
      userId?: string;
      messageId?: string;
    };

    // Generate unique execution ID for debugging
    const executionId = Math.random().toString(36).substring(2, 8);

    const getMeetResults = createTool({
      name: "get_meet_results",
      description:
        "Returns available meet data based on a set of filters, sorting, and limits. Use this to find how lifters performed, compare them, or find lifters that meet certain criteria.",
      parameters: z.object({
        filters: z
          .array(
            z.object({
              column: z.enum(allColumns),
              operator: z
                .enum([
                  "=",
                  "!=",
                  ">",
                  "<",
                  ">=",
                  "<=",
                  "ILIKE",
                  "NOT ILIKE",
                  "IS NULL",
                  "IS NOT NULL",
                ])
                .describe("The operator to use for the filter."),
              value: z
                .union([z.string(), z.number()])
                .optional()
                .describe(
                  "The value to filter by. Not required for IS NULL or IS NOT NULL.",
                ),
            }),
          )
          .optional()
          .describe("An array of filters to apply to the query."),
        orderBy: z
          .enum(allColumns)
          .optional()
          .describe("The column to sort the results by."),
        sortDirection: z
          .enum(["ASC", "DESC"])
          .optional()
          .describe("The direction to sort the results."),
        limit: z
          .number()
          .max(100)
          .optional()
          .describe("The maximum number of results to return."),
      }),
      handler: async (
        { filters, orderBy, sortDirection, limit },
        { network },
      ) => {
        const query_params: Record<string, unknown> = {};
        let paramIndex = 0;

        const whereClauses =
          filters
            ?.map((filter) => {
              const { column, operator, value } = filter;
              if (operator === "IS NULL" || operator === "IS NOT NULL") {
                return `${column} ${operator}`;
              }

              if (value === undefined || value === null) {
                return ""; // Skip invalid filters
              }

              const paramName = `param${paramIndex++}`;

              if (operator === "ILIKE" || operator === "NOT ILIKE") {
                query_params[paramName] = `%${value}%`;
                return `${column} ${operator} {${paramName}:String}`;
              }

              query_params[paramName] = value;
              const paramType = typeof value === "number" ? "Int64" : "String";
              return `${column} ${operator} {${paramName}:${paramType}}`;
            })
            .filter(Boolean)
            .join(" AND ") || "";

        const orderByClause = orderBy
          ? `ORDER BY ${orderBy} ${sortDirection || "DESC"}`
          : "ORDER BY Name, Date DESC";
        const limitClause = limit ? `LIMIT ${limit}` : "LIMIT 20";

        const sql = `
                  SELECT
                    ${allColumns.join(",\n          ")}
                  FROM 'powerlifting-records'
                  ${whereClauses ? `WHERE ${whereClauses}` : ""}
                  ${orderByClause}
                  ${limitClause};
                `;

        try {
          const result = await client.query({
            query: sql,
            query_params,
            format: "JSON",
          });
          const data = (await result.json()).data;

          // Store results in network state for other agents to use
          network.state.data.meetResults = data;

          return data;
        } catch (err) {
          const error = { error: `Query failed: ${(err as Error).message}` };
          return error;
        }
      },
    });
    const meetQueryAgent = createAgent({
      name: "Meet performance analyst",
      description:
        "Answers questions about powerlifting meet results by constructing detailed queries.",
      system: `
            You are an expert powerlifting data analyst. Your only job is to answer user questions by calling the "get_meet_results" tool. You must convert the user's natural language question into the structured JSON parameters that the tool expects.
          
            Do not add any extra text, markdown, or commentary. Your only output should be the tool call.
          
          The tool queries a database of powerlifting meet results. Each row represents a single lifter's performance at a single competition.
          
          **Here is an explanation of the columns:**
          - **Name**: The lifter's name. Duplicates are handled with a suffix (e.g., 'John Doe #1').
          - **Sex**: 'M' for male, 'F' for female, or 'Mx' for gender-neutral.
          - **Event**: The competition type: 'SBD' (Squat-Bench-Deadlift), 'B' (Bench-only), etc.
          - **Equipment**: Equipment category: 'Raw', 'Wraps', 'Single-ply', 'Multi-ply'.
          - **Age**: Lifter's age on meet day. A value like 23.5 means the lifter could be 23 or 24.
          - **AgeClass**: Age category based on exact age, e.g., '40-45'.
          - **BirthYearClass**: Age category based on birth year, used by IPF. e.g., '40-49'.
          - **Division**: Free-form text describing the competition division, e.g., 'Open'.
          - **BodyweightKg**: Lifter's official bodyweight.
          - **WeightClassKg**: The weight class, e.g., '90' (up to 90kg) or '90+' (above 90kg).
          - **Attempt Columns (e.g., Squat1Kg, Bench2Kg)**: Lift attempts in Kg. Negative values mean the attempt was failed.
          - **Squat4Kg, Bench4Kg, Deadlift4Kg**: Fourth attempts for setting records; do not count towards the total.
          - **Best3SquatKg, Best3BenchKg, Best3DeadliftKg**: The best successful attempt from the first three attempts.
          - **TotalKg**: The sum of the three best lifts. Only present if all three lifts were successful.
          - **Place**: A number for the official placing, or a code: 'G' (Guest), 'DQ' (Disqualified), 'DD' (Doping Disqualification).
          - **Dots, Wilks, Glossbrenner, Goodlift**: Different formulas for calculating a lifter's score relative to others. Higher is better. 'Goodlift' points are also called 'IPF GL Points'.
          - **Tested**: 'Yes' if the competition category was drug-tested.
          - **Country, State**: The lifter's home country and state/province.
          - **Federation**: The organizing body for the meet, e.g., 'USAPL'.
          - **ParentFederation**: The international sanctioning body, e.g., 'IPF'.
          - **Date**: The meet's start date in 'YYYY-MM-DD' format.
          - **MeetCountry, MeetState, MeetTown, MeetName**: Details about where the competition was held and its name.
          - **Sanctioned**: 'Yes' if the meet was officially recognized by a federation.
          
          **The full list of available columns is:**
          \`\`\`
          ${allColumns.join(", ")}
          \`\`\`
          
          The tool is very powerful and can filter, sort, and limit results from the database. You must convert the user's natural language question into the structured JSON format the tool expects.
          
          **Tool Schema:**
          \`get_meet_results(filters: Array<{column, operator, value}>, orderBy?: string, sortDirection?: 'ASC' | 'DESC', limit?: number)\`
          
          **Column Names:** \`Name\`, \`Sex\`, \`Event\`, \`Equipment\`, \`Age\`, \`TotalKg\`, \`Best3SquatKg\`, \`Date\`, \`MeetTown\`, etc.
          **Operators:** \`=\`, \`!=\`, \`>\`, \`<\`, \`>=\`, \`<=\`, \`ILIKE\`, \`IS NULL\`, \`IS NOT NULL\`
          
          **Examples:**
          
          1.  **User:** "How did Jakob do at his last meet?"
              **Tool Call:** \`get_meet_results({ filters: [{ column: 'Name', operator: 'ILIKE', value: 'Jakob' }], orderBy: 'Date', sortDirection: 'DESC', limit: 1 })\`
          
          2.  **User:** "who had the biggest squat in houston in the month of february 2024"
              **Tool Call:** \`get_meet_results({ filters: [{ column: 'MeetTown', operator: 'ILIKE', value: 'houston' }, { column: 'Date', operator: '>=', value: '2024-02-01' }, { column: 'Date', operator: '<=', value: '2024-02-29' }], orderBy: 'Best3SquatKg', sortDirection: 'DESC', limit: 1 })\`
          
          3.  **User:** "Top 5 women's totals in the 'USAPL' federation"
              **Tool Call:** \`get_meet_results({ filters: [{ column: 'Sex', operator: '=', value: 'F' }, { column: 'Federation', operator: 'ILIKE', value: 'USAPL' }], orderBy: 'TotalKg', sortDirection: 'DESC', limit: 5 })\`
          
          Think step-by-step to deconstruct the user's query into filters, ordering, and limits. Pay close attention to dates and infer date ranges when a user specifies a month or year. For "biggest" or "best", use \`orderBy\` and \`sortDirection: 'DESC'\`. For "smallest" or "worst", use \`'ASC'\`. Always set a limit.
              `,
      model: anthropic({
        model: "claude-sonnet-4-20250514",
        defaultParameters: {
          temperature: 0.0,
          max_tokens: 5000,
        },
      }),
      // model: gemini({
      //   model: "gemini-2.5-pro",
      // }),
      tools: [getMeetResults],
    });
    const answerAgent = createAgent({
      name: "Meet Summary Agent",
      description: "I am a meet summary agent.",
      system: `
            You are a meet summary agent. Your goal is to provide a comprehensive answer to the user's question.
            
            Original user query: '{{ network.request.originalUserInput }}'
            Query type: {{ network.state.data.isPowerliftingQuery ? 'Powerlifting-related' : 'Non-powerlifting' }}
            {{ network.state.data.routingReasoning ? 'Routing reasoning: ' + network.state.data.routingReasoning : '' }}
            
            {{ if network.state.data.isPowerliftingQuery }}
            This is a powerlifting-related question. Here is the data retrieved:
            
            Meet Results:
            {{ JSON.stringify(network.state.data.meetResults) }}
            
            Please provide a comprehensive answer based on this data. If the data is insufficient or empty, explain what information would be needed to answer the question properly.
            {{ else }}
            This is not a powerlifting-related question. Please provide a helpful and informative response to the user's query. You should politely explain that you specialize in powerlifting data analysis, but still attempt to provide a useful response to their question if possible.
            {{ endif }}
            
            Guidelines:
            - Be conversational and friendly
            - Provide specific details and numbers when available
            - If data is missing or insufficient, explain what's needed
            - For non-powerlifting questions, be helpful while noting your specialization
            `,
      model: gemini({
        model: "gemini-2.5-pro",
      }),
    });

    const supervisorRoutingAgent = createRoutingAgent({
      name: "Supervisor",
      description: "I am a supervisor agent.",
      system: `
            You are a supervisor. Your goal is to manage the workflow to answer a user's question.
            
            You have the following agents at your disposal:
            - 'Meet performance analyst': Use this agent to query the powerlifting database for meet results.
            - 'Meet Summary Agent': Use this agent to formulate an answer to the user.
            
            Your process is as follows:
            1. Examine the user's original query: '{{ network.request.originalUserInput }}'
            2. Determine if this is a powerlifting-related question (about lifters, meets, records, competitions, etc.)
            3. Examine the current data we have retrieved: '{{ JSON.stringify(network.state.data.meetResults) }}'
            
            DECISION LOGIC:
            - If this is NOT a powerlifting question: Call 'route_to_agent' with 'Meet Summary Agent' and set isPowerliftingQuery=false
            - If this IS a powerlifting question AND we have no data: Call 'route_to_agent' with 'Meet performance analyst' 
            - If this IS a powerlifting question AND we have sufficient data: Call 'route_to_agent' with 'Meet Summary Agent' and set isPowerliftingQuery=true
            
            You MUST always call the route_to_agent tool - never leave a query unanswered.
            
            Think step by step and reason through your decision before calling a tool.
            `,
      // model: anthropic({
      //   model: "claude-3-5-sonnet-latest",
      //   defaultParameters: {
      //     max_tokens: 1000,
      //   },
      // }),
      model: gemini({
        model: "gemini-2.5-flash",
      }),
      tools: [
        createTool({
          name: "route_to_agent",
          description: "Route to the specified agent.",
          parameters: z.object({
            agent: z.string().describe("The name of the agent to route to."),
            isPowerliftingQuery: z
              .boolean()
              .optional()
              .describe("Whether this is a powerlifting-related query"),
            reasoning: z
              .string()
              .optional()
              .describe("Brief reasoning for the routing decision"),
          }),
          handler: async (
            { agent, isPowerliftingQuery, reasoning },
            { network },
          ) => {
            // Store the query type in network state for the Meet Summary Agent
            network.state.data.isPowerliftingQuery = isPowerliftingQuery;
            network.state.data.routingReasoning = reasoning;

            // If routing to Meet Summary Agent, set completion flag in state
            if (agent === "Meet Summary Agent") {
              network.state.data.meetSummaryAgentCompleted = true;
            }
            return agent;
          },
        }),
      ],
      lifecycle: {
        onRoute: ({ result }) => {
          const tool = result.toolCalls[0];
          if (!tool) {
            return undefined;
          }

          const toolName = tool.tool.name;

          if (toolName === "route_to_agent") {
            const toolContent = tool.content;
            const agentName =
              typeof toolContent === "object" &&
              toolContent !== null &&
              "data" in toolContent
                ? toolContent.data
                : toolContent;

            if (
              agentName === "meetQueryAgent" ||
              agentName === "Meet performance analyst"
            ) {
              return [meetQueryAgent.name];
            }
            if (
              agentName === "answerAgent" ||
              agentName === "Meet Summary Agent"
            ) {
              return [answerAgent.name];
            }
          }

          return undefined;
        },
      },
    });

    // Optimized router that terminates after Meet Summary Agent based on state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: fix this
    const optimizedRouter = ({ network }: { network: any }) => {
      const isCompleted = network.state.data.meetSummaryAgentCompleted;

      if (isCompleted) {
        return undefined;
      }

      return supervisorRoutingAgent;
    };

    const meetQueryNetwork = createNetwork({
      name: "Meet Query Network",
      agents: [meetQueryAgent, answerAgent, supervisorRoutingAgent],
      // defaultModel: anthropic({
      //   model: "claude-3-5-sonnet-latest",
      //   defaultParameters: {
      //     max_tokens: 1000,
      //   },
      // }),

      defaultModel: gemini({
        model: "gemini-2.5-pro",
      }),
      history: conversationHistoryAdapter,
      router: optimizedRouter,
    });

    try {
      const networkResult = await meetQueryNetwork.run(input, {
        state: {
          data: {
            meetResults: [],
            userId,
            threadId,
            messageId,
            meetSummaryAgentCompleted: false,
          },
        },
      });
    } catch (error) {
      console.error(`[${executionId}] Network execution failed:`, error);
      throw error;
    }
  },
);
