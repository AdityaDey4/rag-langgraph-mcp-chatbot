export const n8nOutput = {
    "pdf_data": {
        "chunks": [
            {
                "chunkIndex": 1,
                "pageNumbers": [
                    1
                ],
                "section": "Java",
                "text": "Java\n\nJava is a general-purpose, object-oriented programming language widely used for backend development, enterprise applications, distributed systems, and Android development. Java programs run on the Java Virtual Machine (JVM), which allows the same compiled bytecode to run across different operating systems. Important Java concepts include classes and objects, inheritance, polymorphism, abstraction, encapsulation, interfaces, exception handling, collections, generics, and multithreading.\n\nThe Java Collections Framework provides commonly used data structures such ArrayList, LinkedList, HashMap, HashSet, Queue, and PriorityQueue. Understanding their internal behavior and time complexity is important for problem solving and backend development. Java also provides strong support for concurrency through threads, executors, synchronization, locks, concurrent collections, and utilities such as BlockingQueue.\n\nFor backend development, Java is commonly used with frameworks such as Spring Boot. Applications can expose REST APIs, communicate with databases, process messages, and interact with other services. Java's memory model and garbage collector are also important for understanding application performance.\n\nFor interview preparation, important areas include OOP, collections, Java memory management, JVM, exception handling, streams, lambda expressions, multithreading, synchronization, and concurrency. A strong understanding of Java should focus not only on syntax but also on why a particular data structure, concurrency mechanism, or design approach is appropriate."
            },
            {
                "chunkIndex": 2,
                "pageNumbers": [
                    1
                ],
                "section": "DBMS",
                "text": "DBMS\n\nA Database Management System (DBMS) is software used to store, organize, retrieve, update, and manage data. Common relational databases include MySQL, PostgreSQL, and Oracle. Relational databases organize information into tables containing rows and columns, while relationships between tables are represented using keys.\n\nImportant DBMS concepts include primary keys, foreign keys, indexes, constraints, normalization, transactions, joins, views, stored procedures, and query optimization. SQL is used to interact with relational databases through commands such as SELECT, INSERT, UPDATE, and DELETE.\n\nTransactions are particularly important in backend systems. A transaction follows the ACID properties: Atomicity, Consistency, Isolation, and Durability. Isolation determines how concurrent transactions interact with each other and helps prevent problems such as dirty reads, non-repeatable reads, and phantom reads.\n\nIndexes improve query performance by allowing the database to find records without scanning the entire table, but they also consume storage and can make writes more expensive. Database connection pooling is another important backend concept because creating a new database connection for every request is inefficient."
            },
            {
                "chunkIndex": 3,
                "pageNumbers": [
                    2
                ],
                "section": "DBMS",
                "text": "DBMS\n\nFor system design, DBMS knowledge extends into replication, partitioning, sharding, caching, failover, backups, and consistency. Understanding when to use SQL versus NoSQL databases is also important. A good DBMS foundation means understanding not only how to write queries, but also how databases physically store and retrieve data and how they behave under concurrent workloads."
            },
            {
                "chunkIndex": 4,
                "pageNumbers": [
                    2
                ],
                "section": "n8n",
                "text": "n8n\n\nn8n is a workflow automation platform that allows different applications and services to communicate with each other through visual workflows. Instead of manually writing an entire integration from scratch, a developer can connect triggers, APIs, databases, transformations, conditions, and external services into a workflow.\n\nA workflow usually starts with a trigger. The trigger might be a webhook, scheduled event, database event, or another application action. The workflow then executes a sequence of nodes. For example, an application could send an order event to n8n, which could validate the data, call another API, store information in a database, and finally send a notification.\n\nn8n is particularly useful for integration and automation tasks. It can communicate with REST APIs, databases, messaging systems, cloud services, email providers, and many other applications. Custom logic can also be added using code nodes when the built-in nodes are not sufficient.\n\nAn important concept is understanding the difference between automation and application backend logic. n8n can reduce the amount of custom integration code required, but critical business logic may still be better maintained inside the main application.\n\nFor learning, useful concepts include triggers, nodes, expressions, webhooks, credentials, HTTP requests, conditional branching, retries, error handling, execution history, and workflow persistence. n8n can be thought of as an orchestration layer that connects multiple systems and automates repetitive processes."
            },
            {
                "chunkIndex": 5,
                "pageNumbers": [
                    2
                ],
                "section": "Redis",
                "text": "Redis\n\nRedis is an in-memory data store commonly used for caching, session storage, counters, distributed coordination, queues, and fast temporary data access. Because Redis primarily operates in memory, it can provide very low-latency operations compared with many traditional database operations.\n\nRedis supports several data structures, including strings, hashes, lists, sets, sorted sets, streams, and more. Each structure is useful for different problems. For example, strings can be used for simple caching, hashes can represent objects, sets can store unique values, and sorted sets can implement ranking systems.\n\nCaching is one of Redis's most common uses. Instead of repeatedly querying a database for frequently requested data, an application can first check Redis. If the value exists, it is returned quickly. If not, the application retrieves the data from the database and stores it in Redis for future requests. Expiration times, commonly called TTLs, prevent cached data from remaining indefinitely."
            },
            {
                "chunkIndex": 6,
                "pageNumbers": [
                    3
                ],
                "section": "Redis",
                "text": "Redis\n\nRedis is also useful in distributed systems. Operations such as SET NX can help implement distributed locks or leader-election mechanisms. Redis can also support rate limiting, counters, session management, and lightweight coordination between services.\n\nHowever, Redis should not automatically replace a database. Its appropriate role depends on durability, consistency, and access requirements. Important concepts to learn include persistence, TTL, eviction policies, pub/sub, streams, transactions, atomic operations, distributed locks, caching strategies, and Redis Cluster."
            },
            {
                "chunkIndex": 7,
                "pageNumbers": [
                    3
                ],
                "section": "Kafka",
                "text": "Kafka\n\nApache Kafka is a distributed event-streaming platform designed to handle large volumes of events reliably. Kafka allows producers to publish events to topics, while consumers read those events independently. This creates asynchronous communication between components and reduces direct coupling between services.\n\nA Kafka topic is divided into partitions. Each partition is an ordered sequence of records. Partitions allow Kafka to scale because different consumers can process different partitions in parallel. Within a consumer group, each partition is assigned to only one consumer at a time. If a topic has three partitions and a consumer group has three active consumers, the workload can potentially be processed in parallel across those consumers.\n\nConsumer groups are also important for understanding Kafka's behavior. Two different consumer groups can independently consume the same event because Kafka tracks offsets separately for each group. This means one event can be processed by multiple independent applications.\n\nKafka producers can configure acknowledgements using acks=0, acks=1, or acks=-1/all, controlling how much broker confirmation is required. Producer idempotence can also help prevent duplicate records caused by producer retries.\n\nOther important concepts include offsets, retention, replication, leaders and followers, partitions, consumer rebalancing, delivery semantics, idempotency, and exactly-once processing. Kafka is not simply a queue; it is a durable event log that allows multiple independent consumers to process the same stream of events according to their own requirements."
            },
            {
                "chunkIndex": 8,
                "pageNumbers": [
                    3
                ],
                "section": "AI",
                "text": "AI\n\nArtificial Intelligence (AI) is the broader field of building systems that can perform tasks normally associated with human intelligence, such as understanding language, recognizing patterns, generating content, making predictions, and assisting with decision-making. Modern AI applications are heavily influenced by machine learning and deep learning.\n\nMachine learning allows systems to learn patterns from data rather than relying entirely on explicitly programmed rules. Deep learning uses neural networks with many layers to learn increasingly complex representations. Large Language Models (LLMs) are a major modern AI technology and are trained to process and generate natural language."
            },
            {
                "chunkIndex": 9,
                "pageNumbers": [
                    4
                ],
                "section": "AI",
                "text": "AI\n\nFor application developers, understanding AI does not necessarily mean starting with advanced mathematics. A practical starting point is learning how to use AI models through APIs, understand prompts, tokens, context windows, embeddings, vector databases, Retrieval-Augmented Generation (RAG), and tool/function calling.\n\nEmbeddings convert information such as text into numerical vectors that represent semantic relationships. Vector databases can store these embeddings and perform similarity searches. RAG combines retrieval with an AI model so that responses can be grounded in external information rather than relying only on the model's training data.\n\nAI applications can also be connected to existing backend systems. For example, a Next.js application can call an AI API, retrieve relevant information from a database or vector store, and provide the retrieved context to the model.\n\nImportant areas to learn include machine learning fundamentals, neural networks, LLMs, prompting, embeddings, vector databases, RAG, agents, tool calling, evaluation, hallucinations, model limitations, and AI application architecture."
            }
        ]
    }
}