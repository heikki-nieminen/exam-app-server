const fs = require('fs')
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcrypt')
const {Pool, Client} = require('pg')
const pg = require('pg')
const EventEmitter = require('events')
const util = require('util')
const jwt = require('jsonwebtoken')
const https = require('https')
const {Server} = require('socket.io')
const {verifyToken, isAdmin, hashPassword} = require("./utils")
const createPostgresSubscriber = require("pg-listen")

require('dotenv').config()

const PORT = 8080

const {DB_USER, DB_HOST, DB_DB, DB_PASSWORD, DB_PORT} = process.env

const pool = new Pool({
	user:     DB_USER,
	host:     DB_HOST,
	database: DB_DB,
	password: DB_PASSWORD,
	port:     DB_PORT
})

const app = express()

const options = {
	key:  fs.readFileSync('./cert/key.pem'),
	cert: fs.readFileSync('./cert/cert.pem')
}

const server = https.createServer(options, app)
server.listen(PORT, function () {
	console.log("Express server listening on port " + PORT)
})
const io = new Server(server, {cors: {origin: 'https://localhost:3000'}})


// DB notifications
const subscriber = createPostgresSubscriber({connectionString: `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_DB}`})
subscriber.notifications.on("my-channel", (payload) => {
	console.log("Notification: ", payload)
})

subscriber.notifications.on("exam-channel", (payload) => {
	console.log("Tenttimuutos: ", payload)
	io.emit("exam-change", "ASD")
})

subscriber.events.on("error", (error) => {
	console.error("Fatal database connection error:", error)
	process.exit(1)
})

process.on("exit", () => {
	console.log("Exit")
	subscriber.close()
})

subscriber.notify("my-channel", {
})

subscriber.connect()
subscriber.listenTo("my-channel")
subscriber.listenTo("exam-channel")


app.use(express.json())
app.use(cors())

io.on("connection", (socket) => {
	console.log("client connected: ",socket.id)
	socket.send("Connection established")
})

// ROOT ROUTE
app.route('/')
	.get(async (req, res) => {
		res.json({message: "Terve"})
	})
	.post(async (req, res) => {
	
	})

// EXAMS ROUTE
app.route('/exams')
	.all(verifyToken)
	.get(async (req, res) => {
		try {
			if (req.decoded.role === 'admin') {
				const result = await pool.query('SELECT name, id FROM exam')
				res.status(200).send(result.rows)
			} else {
				console.log("ID: ", req.decoded.id)
				const result = await pool.query('SELECT * FROM user_exam WHERE user_id=$1', [req.decoded.id])
				res.status(200).send(result.rows)
			}
		} catch (err) {
			console.log(err)
			res.status(400)
		}
	})
	.post(async (req, res) => {
	
	})

// EXAM ROUTE (GET, POST, PUT, DELETE)
app.route('/exam')
	.all(verifyToken)
	.get(async (req, res) => {
		console.log("Haetaan tentti ", req.query.id)
		let exam = {name: "", questions: []}
		let examId
		let result
		const values = [req.query.id]
		try {
			if (req.decoded.role === "admin") {
				result = await pool.query('SELECT * FROM exam WHERE id=$1', values)
				examId = result.rows[0].id
			} else {
				
				//Mitä tehdään jos käyttäjä on jo tehnyt/aloittanut tentin??
				
				const examAnswered = await pool.query('SELECT * FROM user_answer WHERE exam_id=$1', values)
				/*if (examAnswered.rowCount > 0) {
					res.status(200).send("Tentti löytyi")
					return
				}*/
				result = await pool.query('SELECT * FROM user_exam WHERE id=$1', values)
				examId = result.rows[0].exam_id
			}
			if (result.rowCount) {
				console.log("Haetaan kysymykset tenttiin ",examId)
				exam.name = result.rows[0].name
				exam.id = examId
				let questions = await pool.query('SELECT * FROM question WHERE exam_id=$1 ORDER by id ASC', [examId])
				console.log("Saatiin kysymykset ",questions.rows)
				if (questions.rowCount > 0) {
					exam.questions = questions.rows
				}
				/*if (questions.rowCount) {
						exam.questions = questions.rows
						await Promise.all(questions.rows.map(async (item, index) => {
								const answers = await pool.query('SELECT * FROM answer WHERE question_id=$1', [item.id])
								if (answers.rowCount) {
										exam.questions[index].answers = answers.rows
								}
						}))
				}*/
				res.status(200).send(exam)
				
			} else {
				res.status(404).send("Kyseistä tenttiä ei löydy")
			}
		} catch (err) {
			console.log(err)
			res.status(400).send("Virhe haettaessa dataa")
		}
	})
	.post(isAdmin, async (req, res) => {
		const values = [req.body.examName]
		try {
			const result = await pool.query('INSERT INTO exam (name) VALUES ($1) RETURNING id', values)
			res.status(200).send(result.rows[0].id)
		} catch (err) {
			console.log(err)
			res.status(400).send(err)
		}
	})
	.put(verifyToken, isAdmin, async (req, res) => {
		const values = [req.body.examId, req.body.examName]
		console.log(req.body)
		try {
			const result = await pool.query('UPDATE exam SET name=$2 WHERE id=$1 RETURNING id', values)
			res.status(200).send("OK")
		} catch (err) {
			console.log(err)
			res.status(400).send(err)
		}
	})
	.delete(isAdmin, async (req, res) => {
		const values = [req.body.id]
		// Käyttäjän vahvistus?
		try {
			const result = await pool.query('DELETE FROM exam WHERE id=$1', values)
			res.status(200).send("OK")
		} catch (err) {
			console.log(err)
			res.status(400).send(err)
		}
	})

// QUESTION ROUTE (GET, POST, PUT, DELETE)
app.route('/exam/question')
	.all(verifyToken)
	.get(async (req, res) => {
		const questionId = req.query.id
		try {
			const result = await pool.query('SELECT * FROM answer WHERE question_id=$1 ORDER by id ASC', [questionId])
			res.status(200).send(result.rows)
		} catch (err) {
			res.status(404).send("Virhe haettaessa dataa")
		}
	})
	.post(isAdmin, async (req, res) => {
		const values = [req.body.question, req.body.exam_id]
		try {
			const result = await pool.query('INSERT INTO question (question, exam_id) VALUES ($1,$2) RETURNING id', values)
			res.status(200).send(result.rows[0].id)
		} catch (err) {
			console.log(err)
			res.status(400).send(err)
		}
	})
	.put(isAdmin, async (req, res) => {
		const values = [req.body.id, req.body.question]
		try {
			const result = await pool.query('UPDATE question SET question=$2 WHERE id=$1', values)
			res.status(200).send("Ok")
		} catch (err) {
			console.log(err)
			res.status(400).send(err)
		}
	})
	.delete(isAdmin, async (req, res) => {
		const values = [req.body.id]
		// VAHVISTUS
		try {
			const result = await pool.query('DELETE FROM question WHERE id=$1', values)
			res.status(204).send("OK")
		} catch (err) {
			console.log(err)
			res.status(400).send(err.detail)
		}
	})

// ANSWER ROUTE (GET, POST, PUT, DELETE)
app.route('/exam/question/answer')
	.all(verifyToken)
	.get(async (req, res) => {
		const values = [req.query.id]
		try {
			const result = await pool.query('SELECT * FROM answer WHERE id=$1', values)
			res.send(result.rows[0])
		} catch (err) {
			console.log(err)
			res.status(404).send("Virhe haettaessa dataa")
		}
	})
	.post(isAdmin, async (req, res) => {
		const values = [req.body.answer, req.body.question_id, req.body.correct_answer]
		try {
			const result = await pool.query('INSERT INTO answer (answer, question_id, correct_answer) VALUES' +
				' ($1, $2, $3) RETURNING id', values)
			res.status(201).send(result.rows[0].id)
			
		} catch (err) {
			console.log(err)
			res.status(400).send(err)
		}
	})
	.put(isAdmin, async (req, res) => {
		const values = [req.body.id, req.body.answer, req.body.isCorrect]
		try {
			const result = await pool.query('UPDATE answer SET answer=$2, correct_answer=$3 WHERE id=$1', values)
			res.status(201).send("OK")
		} catch (err) {
			console.log(err)
			res.status(400)
		}
	})
	.delete(isAdmin, async (req, res) => {
		const values = [req.body.id]
		try {
			console.log("Poistetaan vastaus: ", req.body.id)
			const result = await pool.query('DELETE FROM answer WHERE id=$1', values)
			res.status(204).send("OK")
		} catch (err) {
			console.log(err)
			res.status(400).send(err)
		}
	})

// LOGIN ROUTE (GET, POST)
app.route('/login')
	.get(async (req, res) => {
	
	})
	.post(async (req, res) => {
		console.log("KIRJAUTUMINEN")
		const username = req.body.username
		const plainPassword = req.body.password
		let token
		try {
			const pass = await pool.query('SELECT password, role, id FROM public.user WHERE username=$1', [username])
			if (pass.rowCount > 0) {
				const hash = pass.rows[0].password
				const result = await bcrypt.compare(plainPassword, hash)
				if (result) {
					token = await jwt.sign({
						id:       pass.rows[0].id,
						username: username,
						role:     pass.rows[0].role
					}, process.env.SECRET_KEY, {expiresIn: "1h"})
					res.status(201).json({correct: true, role: pass.rows[0].role, id: pass.rows[0].id, token: token, name: pass.rows[0].username})
				} else {
					res.status(401).json({correct: false, message: "Wrong username or password"})
				}
			} else {
				res.status(401).json({correct: false, message: "Wrong username or password"})
			}
		} catch (err) {
			res.status(400).json({correct: false, message: "Palvelinvirhe"})
		}
	})

// REGISTER ROUTE (GET, POST)
app.route('/register')
	.get(async (req, res) => {
	
	})
	.post(async (req, res) => {
		console.log(req.body)
		const username = req.body.username
		const plainPassword = req.body.password
		const email = req.body.email
		try {
			const password = await hashPassword(plainPassword)
			const values = [username, password, email]
			const result = await pool.query("INSERT INTO public.user (username, password, email, role) " +
				"VALUES ($1,$2,$3,'user')", values)
			console.log(result)
			res.status(201).send(true)
		} catch (err) {
			if (err.code === '23505') {
				res.status(400).send("Käyttäjätunnus varattu")
			} else {
				console.log(err)
				res.send(false)
			}
		}
	})

// USERS ROUTE
app.route('/users')
	.all(verifyToken)
	.all(isAdmin)
	.get(async (req, res) => {
		try {
			const result = await pool.query("SELECT * FROM public.user ORDER by id ASC")
			if (result.rowCount > 0) {
				res.status(200).json({users: result.rows})
			}
		} catch (err) {
			res.status(400)
		}
	})
	.post(async (req, res) => {
	
	})
	.put(async (req, res) => {
		try {
			console.log(req.body)
			const result = await pool.query("UPDATE public.user SET role=$1 WHERE id=$2", [req.body.role, req.body.id])
			if (result.rowCount > 0) {
				console.log("Päivitetty onnistuneesti")
				res.status(200)
			}
		} catch (err) {
			console.log(err)
		}
	})
	.delete(async (req, res) => {
		try {
			const result = await pool.query("DELETE FROM public.user WHERE id=$1", [req.body.id])
			res.status(204)
		} catch (err) {
			console.log(err)
			res.status(400)
		}
	})

app.route('/users/exam')
	.all(verifyToken)
	.get(async (req, res) => {
	
	})
	.post(async (req, res) => {
		let userId = req.body.userId
		let examId = req.body.examId
		try {
			const result = await pool.query('INSERT INTO user_exam (exam_id, user_id, name) VALUES ($1,$2,$3)',
				[req.body.examId, req.body.userId, req.body.name])
			res.status(201).send("OK")
		} catch (err) {
			console.log(err)
			res.status(400)
		}
	})

app.route('/email')
	.post(async (req, res) => {
		const {email, subject, text} = req.body
		try {
			emailsender.send(email, subject, text)
		} catch (err) {
			console.log(err)
		}
	})

// AUTHENTICATION CHECK
app.get('/RequestAccess', verifyToken, (req, res) => {
	console.log("REQUEST ACCESS")
	res.status(200).json(req.decoded)
})

app.get('/isAdmin', [verifyToken, isAdmin], (req, res) => {
	res.status(200).send(true)
})

// TODO: userId from verifyToken
app.post('/useranswer', verifyToken, async (req, res) => {
	const values = [req.body.examId, req.body.questionId, req.body.answerId, req.body.userId]
	
	try {
		const result = await pool.query('INSERT INTO user_answer (exam_id, question_id, answer_id, user_id) VALUES' +
			' ($1,$2,$3,$4)', values)
		console.log("Vastaus tallennettu")
		res.status(200)
	} catch (err) {
		console.log(err)
		res.status(400)
	}
})

app.route('/userexam')
	.all(verifyToken)
	.get(async (req, res) => {
	
	})
	.put(async (req, res) => {
		try{
			const result = await pool.query('UPDATE user_exam SET is_completed=true WHERE user_id=$1 exam_id= $2', [req.body.userId, req.body.examId])
			if(result.rowCount){
				res.status(200)
			}
		}catch(err){
			console.log(err)
			res.status(400)
		}
	})
