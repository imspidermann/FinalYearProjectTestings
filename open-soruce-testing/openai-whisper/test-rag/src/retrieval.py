# retrieval.py
# Retrieve relevant chunks from ChromaDB based on user query

import chromadb
import ollama

COLLECTION_NAME = "college_info"

client = chromadb.Client()

# Ensure collection exists
try:
    collection = client.get_collection(COLLECTION_NAME)
except chromadb.errors.NotFoundError:
    collection = client.create_collection(COLLECTION_NAME)

def retrieve_context(query, top_k=3):
    emb_result = ollama.embeddings("nomic-embed-text", query)
    query_vector = emb_result['embedding']

    results = collection.query(
        query_embeddings=[query_vector],
        n_results=top_k
    )

    context = "\n".join(results['documents'][0]) if results['documents'] else ""
    return context
