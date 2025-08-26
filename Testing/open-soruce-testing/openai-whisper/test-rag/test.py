from src.retrieval import retrieve_context

query = "Tell me about BCA admission"
context = retrieve_context(query)
print(context)
