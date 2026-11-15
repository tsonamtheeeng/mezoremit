# MezoRemit demo — voiceover script

Voice: Microsoft Andrew (en-US-AndrewNeural, edge-tts). Recorded against https://mezoremit.vercel.app on Mezo Testnet, with real transactions.

## intro
This is MezoRemit. It sends money across borders and settles in MUSD, the Bitcoin-backed dollar on Mezo. Sending money home is still slow and expensive, and the fees are hard to see until it's too late.

## how
MezoRemit shows every cost before you send. You can pay straight to a wallet, or send a claim link to someone who doesn't have a wallet yet. Recipients can be in Mexico, the Philippines, India, Europe and more. Every currency is shown with its own symbol.

## connect
Let's send money live on Mezo Testnet. The sender connects with Mezo Passport, so Bitcoin wallets like Unisat, OKX and Xverse work, as well as any Ethereum wallet. Signing in is a free signature, not a transaction.

## country
First, where the money is going. We'll send to the Philippines, in Philippine pesos.

## amount
Twenty-five MUSD. The wallet balance is right there, so there are no surprises.

## recipient
The sender doesn't know their cousin's wallet address. That's fine. MezoRemit makes a claim link instead.

## delivery
The link expires in seven days. If nobody claims it by then, the money goes back to the sender.

## review
Before anything moves, the review screen lists every line. The service fee is zero on testnet. The network fee is paid in BTC. The peso rate is shown too, clearly marked as an estimate, because the recipient gets MUSD. The sender adds a short message.

## fund
One signature and one transaction lock the twenty-five MUSD in the contract on Mezo. MezoRemit never holds it.

## link
The link is ready. The secret key lives only in the part of the link that browsers never send to a server, so even MezoRemit can't claim it. The sender shares it in any private chat, or as a QR code.

## claim_open
Now the recipient opens the link. They see the amount, who sent it, and the message.

## claim_connect
They connect a wallet. No account to create, and no BTC needed.

## claim
Claiming is free. MezoRemit's relayer pays the network fee, and the contract only pays the wallet named in the claim. Nobody can redirect it.

## claimed
Done. Twenty-five MUSD landed in the recipient's own wallet, with a link to the transaction on the Mezo explorer.

## track
Back on the sender's side, the transfer shows as claimed. Each step was checked against Mezo before it was marked as done.

## outro
No pooled funds, no admin keys, and every fee shown up front. The testnet contracts are listed in the footer. That's MezoRemit: send money across borders, settle in MUSD.
