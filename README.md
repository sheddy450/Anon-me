# ANON_ME! — putting it online


## How it works, briefly

- People who sign up get a link. Visitors to that link need no account.
- A visitor's browser keeps a random secret key. That key, not a name or address,
  is what lets them return to their chat. The inbox owner never sees it.
- Each chat closes after 10 messages. The owner can block or report a chat.
- Logging in uses email and password (the design showed a username field; Supabase
  signs people in by email, and looking up an email from a username would expose
  users' email addresses).
