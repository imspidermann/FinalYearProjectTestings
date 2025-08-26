# rag_bot.py
# Main bot logic: construct prompt + call Mistral

import ollama
from src.retrieval import retrieve_context

SYSTEM_PROMPT = """You are a helpful assistant for Tech University of India.
Answer only using the provided context from the knowledge base.
If the answer is not available, politely say:
"I’m sorry, I can only provide information related to Tech University of India."
"""
def ask_bot(query, chat_history=[]):
    context = retrieve_context(query)
    user_prompt = f"Context:\n{context}\n\nQuestion: {query}"

    full_prompt = SYSTEM_PROMPT
    if chat_history:
        full_prompt += "\n".join(chat_history) + "\n"
    full_prompt += user_prompt

    response = ollama.chat(
        model="mistral:latest",
        messages=[{"role": "user", "content": full_prompt}]
    )

    # Updated access to response
    answer = response.message.content
    return answer

