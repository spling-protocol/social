import { getKeypairFromSeed, getOrCreateShadowDriveAccount } from '../../../utils/helpers'
import { PostUser, UserFileData, Reply, ReplyFileData } from '../../../types'
import * as anchor from '@project-serum/anchor'
import { web3 } from '@project-serum/anchor'
import { isBrowser, programId, shadowDriveDomain, SPLING_TOKEN_ACCOUNT_RECEIVER, SPLING_TOKEN_ADDRESS } from '../../../utils/constants'
import dayjs from 'dayjs'
import { UserChain } from '../../../models'
import { getUserFileData } from '../../user/helpers'
import { ShadowFile } from 'react-native-shadow-drive'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

/**
 * Creates a reply to the given post.
 * 
 * @category Post
 * 
 * @param {number} postId The id of the post to reply to.
 * @param {string} text The content of the reply.
 * 
 * @returns {Promise<Reply>} - A promise that resolves with the new created reply.
 */
export default async function createPostReply(postId: number, text: string): Promise<Reply> {
  try {
    // Find spling pda.
    const [SplingPDA] = web3.PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('spling')],
      programId,
    )

    // Find the user profile pda.
    const [UserProfilePDA] = web3.PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('user_profile'), this.wallet.publicKey.toBuffer()],
      programId,
    )

    // Fetch the user id.
    const fetchedUserProfile = await this.anchorProgram.account.userProfile.fetch(UserProfilePDA)
    const userChain = new UserChain(fetchedUserProfile)

    // Get current timestamp.
    const timestamp: string = dayjs().unix().toString()

    // Generate the hash from the text.
    const hash: web3.Keypair = getKeypairFromSeed(
      `${timestamp}${userChain.userId.toString()}${postId.toString()}`,
    )

    // Find reply pda.
    const [ReplyPDA] = web3.PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('reply'), hash.publicKey.toBuffer()],
      programId,
    )

    // Create text tile to upload.
    let replyTextFile
    if (!isBrowser) {
      const RNFS = require('react-native-fs')
      const replyTextPath = `${RNFS.DownloadDirectoryPath}/${ReplyPDA.toString()}.txt`
      await RNFS.writeFile(replyTextPath, text, 'utf8')
      const statResult = await RNFS.stat(replyTextPath)
      const file = await RNFS.readFile(replyTextPath, 'utf8')

      replyTextFile = {
        uri: `file://${replyTextPath}`,
        type: 'text/plain',
        file: Buffer.from(file, 'utf8'),
        name: `${ReplyPDA.toString()}.txt`,
        size: statResult.size,
      } as ShadowFile
    } else {
      replyTextFile = new File(
        [new Blob([text], { type: 'text/plain' })],
        `${ReplyPDA.toString()}.txt`,
      )
    }

    // Generate the reply json to upload.
    const replyJson: ReplyFileData = {
      timestamp: timestamp,
      userId: userChain.userId.toString(),
      postId: postId.toString(),
      text: `${ReplyPDA.toString()}.txt`,
    }

    let replyJSONFile
    if (!isBrowser) {
      const RNFS = require('react-native-fs')
      const replyJSONPath = `${RNFS.DocumentDirectoryPath}/${ReplyPDA.toString()}.json`
      await RNFS.writeFile(replyJSONPath, JSON.stringify(replyJson), 'utf8')
      const statResult = await RNFS.stat(replyJSONPath)
      const file = await RNFS.readFile(replyJSONPath, 'utf8')

      replyJSONFile = {
        uri: `file://${replyJSONPath}`,
        type: 'application/json',
        file: Buffer.from(file, 'utf8'),
        name: `${ReplyPDA.toString()}.json`,
        size: statResult.size,
      } as ShadowFile
    } else {
      const fileToSave = new Blob([JSON.stringify(replyJson)], { type: 'application/json' })
      replyJSONFile = new File([fileToSave], `${ReplyPDA.toString()}.json`)
    }

    // 1024 bytes will be reserved for the reply.json.
    const fileSizeSummarized = 1024 + replyTextFile.size

    // Find/Create shadow drive account.
    const account = await getOrCreateShadowDriveAccount(this.shadowDrive, fileSizeSummarized)

    // Upload reply text and reply json file.
    await this.shadowDrive.uploadFile(
      account.publicKey,
      !isBrowser ? (replyTextFile as ShadowFile) : (replyTextFile as File),
    )

    await this.shadowDrive.uploadFile(
      account.publicKey,
      !isBrowser ? (replyJSONFile as ShadowFile) : (replyJSONFile as File),
    )

    // Remove created device files if necessary.
    if (!isBrowser) {
      const RNFS = require('react-native-fs')
      await RNFS.unlink(`${RNFS.DocumentDirectoryPath}/${ReplyPDA.toString()}.txt`)
      await RNFS.unlink(`${RNFS.DocumentDirectoryPath}/${ReplyPDA.toString()}.json`)
    }

    // Find bank pda.
    const [BankPDA] = web3.PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode('b')],
      programId,
    )

    // Submit the post to the anchor program.
    const transactionCosts = this.tokenAccount !== null ? new anchor.BN(1123600) : null
    await this.anchorProgram.methods
      .submitReply(postId, hash.publicKey, transactionCosts)
      .accounts({
        user: this.wallet.publicKey,
        userProfile: UserProfilePDA,
        reply: ReplyPDA,
        spling: SplingPDA,
        b: BankPDA,
        receiver: this.wallet.publicKey,
        senderTokenAccount: this.tokenAccount ?? new PublicKey("2cDKYNjMNcDCxxxF7rauq8DgvNXD9r9BVLzKShPrJGUw"),
        receiverTokenAccount: SPLING_TOKEN_ACCOUNT_RECEIVER,
        mint: SPLING_TOKEN_ADDRESS,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc()

    // Get user profile json file from the shadow drive.
    const userProfileJson: UserFileData = await getUserFileData(userChain.shdw)

    return Promise.resolve({
      publicKey: ReplyPDA,
      timestamp: Number(timestamp),
      status: 1,
      userId: Number(replyJson.userId),
      postId: postId,
      text: text,
      user: {
        publicKey: userChain.publicKey,
        nickname: userProfileJson.nickname,
        avatar:
          userProfileJson.avatar != null
            ? `${shadowDriveDomain}${userChain.shdw.toString()}/${userProfileJson.avatar.file}`
            : null,
      } as PostUser,
    } as Reply)
  } catch (error) {
    return Promise.reject(error)
  }
}
