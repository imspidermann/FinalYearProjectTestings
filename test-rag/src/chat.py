# chat.py
# CLI interface for multi-turn conversation

from src.rag_bot import ask_bot

def run_chat():
    print("Welcome to Tech University of India Info Chatbot!")
    print("Type 'exit' or 'quit' to end the chat.\n")

    chat_history = []

    while True:
        user_input = input("You: ")
        if user_input.lower() in ["exit", "quit"]:
            print("Bot: Goodbye!")
            break

        answer = ask_bot(user_input, chat_history)
        print(f"Bot: {answer}\n")

        chat_history.append(f"User: {user_input}\nBot: {answer}")

if __name__ == "__main__":
    run_chat()
