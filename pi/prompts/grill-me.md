---
description: Relentless interview to reach shared understanding, answers via editable file
argument-hint: "[topic]"
---

# Grill Me

## Topic
$@

If no topic is given, use the current plan or discussion as the topic.

Interview me relentlessly about every aspect of this topic until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one by one.

## Rules

- Ask questions one at a time (one round = one file write, see below).
- If a question can be answered by exploring the codebase, explore the codebase instead of asking.
- For each question you do ask, provide your recommended answer.

## Persistence mechanism

Answers happen in an editable file, not in the agent prompt:

1. Write each round of questions to `.agents/interviews/YYYY-MM-DD-<topic>.md` in the project (create the directory if needed).
2. One section per question: the question, context, your recommended answer, and an empty `Answer:` block.
3. Tell me the file path; I answer by editing the file in my editor.
4. When I say I have answered, read the file back and process the answers.
5. Append follow-up questions to the same file (or a new dated file) and repeat until shared understanding is reached.

## Wrap-up

When done, summarize all decisions reached in the interview file and remind me to promote durable decisions to their proper home (ADRs, AGENTS.md, SPECS.md).
