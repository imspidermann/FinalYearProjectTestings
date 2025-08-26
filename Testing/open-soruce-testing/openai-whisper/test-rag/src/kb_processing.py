# kb_processing.py
# Load KB, chunk it, create embeddings, and store in ChromaDB

from langchain.text_splitter import RecursiveCharacterTextSplitter
import chromadb
import ollama

KB_PATH = "E:/FinalYearProject/test-rag/data/college_info.md"
COLLECTION_NAME = "college_info"

def create_embeddings():
    # Load KB
    with open(KB_PATH, "r", encoding="utf-8") as f:
        kb_text = f.read()

    # Chunk KB
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50
    )
    kb_chunks = text_splitter.split_text(kb_text)
    print(f"Total chunks: {len(kb_chunks)}")

    # Initialize ChromaDB
    client = chromadb.Client()
    try:
        collection = client.get_collection(COLLECTION_NAME)
        print("Collection exists. Clearing previous data...")
        collection.delete()
    except chromadb.errors.NotFoundError:
        collection = client.create_collection(COLLECTION_NAME)
        print("Collection created.")

    # Create embeddings and add to ChromaDB
    for i, chunk in enumerate(kb_chunks):
        emb_result = ollama.embeddings("nomic-embed-text", chunk)
        embedding_vector = emb_result['embedding']

        collection.add(
            documents=[chunk],
            metadatas=[{"chunk_id": i}],
            ids=[str(i)],
            embeddings=[embedding_vector]
        )
        if i % 10 == 0:
            print(f"Processed chunk {i+1}/{len(kb_chunks)}")

    print("KB embeddings created and stored successfully!")

if __name__ == "__main__":
    create_embeddings()
