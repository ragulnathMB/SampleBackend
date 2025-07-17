const express = require('express');
const sql = require('mssql');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database configuration
const dbConfig = {
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || 'EmployeeDB',
    user: process.env.DB_USER || 'testuser',
    password: process.env.DB_PASSWORD || '1234',
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

// Database connection
let pool;
sql.connect(dbConfig).then(p => {
    pool = p;
    console.log('Connected to MSSQL');
}).catch(err => {
    console.error('Database connection error:', err);
});




// PROFILE MANAGEMENT APIs

// View Profile API
app.get('/api/profile/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        
        const result = await request.query(`
            SELECT EmpID, Name, DOB, DOJ, Position, Grade, ManagerEmpID
            FROM EmpProfileTable 
            WHERE EmpID = @empId
        `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        
        res.json(result.recordset[0]);
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Update Profile API
app.patch('/api/profile/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        const { position, grade } = req.body;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        request.input('position', sql.VarChar(50), position);
        request.input('grade', sql.Int, grade);
        
        await request.query(`
            UPDATE EmpProfileTable 
            SET Position = @position, Grade = @grade
            WHERE EmpID = @empId
        `);
        
        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});


// LEAVE MANAGEMENT APIs

// Apply for Leave
app.post('/api/leave/apply', async (req, res) => {
    try {
        const { leaveId, empId, fromDate, toDate, type } = req.body;
        
        // Validate date conflicts
        const checkRequest = pool.request();
        checkRequest.input('empId', sql.VarChar(30), empId);
        checkRequest.input('fromDate', sql.DateTime, fromDate);
        checkRequest.input('toDate', sql.DateTime, toDate);
        
        const conflictCheck = await checkRequest.query(`
            SELECT * FROM LeaveReqTable 
            WHERE EmpID = @empId AND Status IN ('Pending', 'Approved')
            AND ((@fromDate BETWEEN FromDate AND ToDate) OR (@toDate BETWEEN FromDate AND ToDate))
        `);
        
        if (conflictCheck.recordset.length > 0) {
            return res.status(400).json({ error: 'Leave dates conflict with existing requests' });
        }
        
        // Get manager ID
        const managerRequest = pool.request();
        managerRequest.input('empId', sql.VarChar(30), empId);
        
        const managerResult = await managerRequest.query(`
            SELECT ManagerEmpID FROM EmpProfileTable WHERE EmpID = @empId
        `);
        
        const managerId = managerResult.recordset[0]?.ManagerEmpID;
        
        // Insert leave request
        const request = pool.request();
        request.input('leaveId', sql.Int, leaveId);
        request.input('empId', sql.VarChar(30), empId);
        request.input('fromDate', sql.DateTime, fromDate);
        request.input('toDate', sql.DateTime, toDate);
        request.input('type', sql.VarChar(4), type);
        
        await request.query(`
            INSERT INTO LeaveReqTable (LeaveID, EmpID, FromDate, ToDate, Type, RequestDate, Status)
            VALUES (@leaveId, @empId, @fromDate, @toDate, @type, GETDATE(), 'Pending')
        `);
        
        // Send notification to manager
        if (managerId) {
            await sendNotification(managerId, 'New Leave Request', `Leave request from ${empId}`, 'leave');
        }
        
        res.json({ message: 'Leave application submitted successfully' });
    } catch (error) {
        console.error('Leave application error:', error);
        res.status(500).json({ error: 'Failed to apply for leave' });
    }
});

// View Leave Balance
app.get('/api/leave/balance/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        
        const result = await request.query(`
            SELECT 
                l.Type,
                l.Description,
                COALESCE(SUM(CASE WHEN lr.Status = 'Approved' THEN DATEDIFF(day, lr.FromDate, lr.ToDate) + 1 ELSE 0 END), 0) as Used,
                (CASE 
                    WHEN l.Type = 'SL' THEN 12
                    WHEN l.Type = 'CL' THEN 12
                    WHEN l.Type = 'PL' THEN 21
                    ELSE 0
                END) as Total
            FROM LeaveTable l
            LEFT JOIN LeaveReqTable lr ON l.LeaveID = lr.LeaveID AND lr.EmpID = @empId 
                AND YEAR(lr.FromDate) = YEAR(GETDATE())
            GROUP BY l.Type, l.Description
        `);
        
        const balance = result.recordset.map(item => ({
            type: item.Type,
            description: item.Description,
            total: item.Total,
            used: item.Used,
            remaining: item.Total - item.Used
        }));
        
        res.json(balance);
    } catch (error) {
        console.error('Leave balance error:', error);
        res.status(500).json({ error: 'Failed to fetch leave balance' });
    }
});

// View Leave Status/History
app.get('/api/leave/history/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        
        const result = await request.query(`
            SELECT lr.LeaveReqID, lr.FromDate, lr.ToDate, lr.Type, lr.Status, lr.RequestDate, l.Description
            FROM LeaveReqTable lr
            JOIN LeaveTable l ON lr.LeaveID = l.LeaveID
            WHERE lr.EmpID = @empId
            ORDER BY lr.RequestDate DESC
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Leave history error:', error);
        res.status(500).json({ error: 'Failed to fetch leave history' });
    }
});


//  ATTENDANCE MANAGEMENT APIs

// Check-In API
app.post('/api/attendance/checkin', async (req, res) => {
    try {
        const { empId } = req.body;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        request.input('checkInTime', sql.DateTime, new Date());
        
        await request.query(`
            INSERT INTO AttendanceTable (EmpID, CheckInTime, Date)
            VALUES (@empId, @checkInTime, CAST(GETDATE() AS DATE))
        `);
        
        console.log(`CHECK-IN: Employee ${empId} checked in at ${new Date()}`);
        res.json({ message: 'Check-in successful', time: new Date() });
    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({ error: 'Failed to check in' });
    }
});

// Check-Out API
app.post('/api/attendance/checkout', async (req, res) => {
    try {
        const { empId } = req.body;
        const checkOutTime = new Date();
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        request.input('checkOutTime', sql.DateTime, checkOutTime);
        
        // Update attendance record and calculate working hours
        await request.query(`
            UPDATE AttendanceTable 
            SET CheckOutTime = @checkOutTime,
                WorkingHours = DATEDIFF(HOUR, CheckInTime, @checkOutTime)
            WHERE EmpID = @empId AND Date = CAST(GETDATE() AS DATE)
        `);
        
        console.log(`CHECK-OUT: Employee ${empId} checked out at ${checkOutTime}`);
        res.json({ message: 'Check-out successful', time: checkOutTime });
    } catch (error) {
        console.error('Check-out error:', error);
        res.status(500).json({ error: 'Failed to check out' });
    }
});

// Attendance History View
app.get('/api/attendance/history/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        const { month, year } = req.query;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        request.input('month', sql.Int, month || new Date().getMonth() + 1);
        request.input('year', sql.Int, year || new Date().getFullYear());
        
        const result = await request.query(`
            SELECT Date, CheckInTime, CheckOutTime, WorkingHours, Status
            FROM AttendanceTable
            WHERE EmpID = @empId 
            AND MONTH(Date) = @month 
            AND YEAR(Date) = @year
            ORDER BY Date DESC
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Attendance history error:', error);
        res.status(500).json({ error: 'Failed to fetch attendance history' });
    }
});


// PAYROLL MANAGEMENT APIs

// Generate Payslip
app.post('/api/payroll/generate/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        const { month, year } = req.body;
        
        // Get employee details
        const empRequest = pool.request();
        empRequest.input('empId', sql.VarChar(30), empId);
        
        const empResult = await empRequest.query(`
            SELECT * FROM EmpProfileTable WHERE EmpID = @empId
        `);
        
        if (empResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        const employee = empResult.recordset[0];
        
        
        const baseSalary = employee.Grade * 10000;
        const deductions = baseSalary * 0.12;
        const netSalary = baseSalary - deductions;
        
        
        const payslipRequest = pool.request();
        payslipRequest.input('empId', sql.VarChar(30), empId);
        payslipRequest.input('period', sql.Date, new Date(year, month - 1, 1));
        
        await payslipRequest.query(`
            INSERT INTO PayslipTable (EmpID, Period, CreatedDate)
            VALUES (@empId, @period, GETDATE())
        `);
        
        console.log(`PAYSLIP: Generated for ${empId} - Base: ${baseSalary}, Net: ${netSalary}`);
        
        res.json({ 
            message: 'Payslip generated successfully',
            empId,
            baseSalary,
            deductions,
            netSalary
        });
    } catch (error) {
        console.error('Payslip generation error:', error);
        res.status(500).json({ error: 'Failed to generate payslip' });
    }
});

// View Payslip API
app.get('/api/payroll/payslips/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        
        const result = await request.query(`
            SELECT Period, CreatedDate 
            FROM PayslipTable 
            WHERE EmpID = @empId
            ORDER BY Period DESC
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Payslip fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch payslips' });
    }
});


// DOCUMENT MANAGEMENT APIs

// Document Request API
app.post('/api/documents/request', async (req, res) => {
    try {
        const { empId, type } = req.body;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        request.input('type', sql.VarChar(20), type);
        request.input('status', sql.VarChar(15), 'Active');
        
        await request.query(`
            INSERT INTO DocumentReqTable (EmpID, Type, Status, ReqDate)
            VALUES (@empId, @type, @status, GETDATE())
        `);
        
        console.log(`DOCUMENT REQUEST: ${empId} requested ${type} document`);
        res.json({ message: 'Document request submitted successfully' });
    } catch (error) {
        console.error('Document request error:', error);
        res.status(500).json({ error: 'Failed to submit document request' });
    }
});

// View All Documents API
app.get('/api/documents/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        
        const result = await request.query(`
            SELECT DocumentReqID, Type, Status, ReqDate
            FROM DocumentReqTable
            WHERE EmpID = @empId
            ORDER BY ReqDate DESC
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Document fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});


// REIMBURSEMENT MANAGEMENT APIs


// Submit Reimbursement Request
app.post('/api/reimbursement/submit', async (req, res) => {
    try {
        const { empId, type, amount, comment } = req.body;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        request.input('type', sql.VarChar(20), type);
        request.input('amount', sql.Decimal(10, 2), amount);
        request.input('comment', sql.VarChar(100), comment);
        request.input('status', sql.VarChar(15), 'Pending');
        
        await request.query(`
            INSERT INTO ReimbursementTable (EmpID, Type, Amount, Comment, Status, CreatedDate)
            VALUES (@empId, @type, @amount, @comment, @status, GETDATE())
        `);
        
        console.log(`REIMBURSEMENT: ${empId} submitted ${type} claim for ${amount}`);
        res.json({ message: 'Reimbursement request submitted successfully' });
    } catch (error) {
        console.error('Reimbursement submission error:', error);
        res.status(500).json({ error: 'Failed to submit reimbursement request' });
    }
});

// View Reimbursement History
app.get('/api/reimbursement/history/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        
        const result = await request.query(`
            SELECT ReimbursementID, Type, Amount, Comment, Status, CreatedDate
            FROM ReimbursementTable
            WHERE EmpID = @empId
            ORDER BY CreatedDate DESC
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Reimbursement history error:', error);
        res.status(500).json({ error: 'Failed to fetch reimbursement history' });
    }
});


// NOTIFICATION MANAGEMENT APIs

// Create Notification API
app.post('/api/notifications/create', async (req, res) => {
    try {
        const { targetEmpId, title, content, type } = req.body;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), targetEmpId);
        request.input('title', sql.VarChar(200), title);
        request.input('content', sql.VarChar(500), content);
        request.input('type', sql.VarChar(20), type);
        
        await request.query(`
            INSERT INTO NotificationTable (EmpID, Title, Content, Type, Status, CreatedDate)
            VALUES (@empId, @title, @content, @type, 'unread', GETDATE())
        `);
        
        console.log(`NOTIFICATION CREATED: ${title} for ${targetEmpId}`);
        res.json({ message: 'Notification created successfully' });
    } catch (error) {
        console.error('Notification creation error:', error);
        res.status(500).json({ error: 'Failed to create notification' });
    }
});

// Fetch Notifications API
app.get('/api/notifications/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        
        const result = await request.query(`
            SELECT NotificationID, Title, Content, Type, Status, CreatedDate
            FROM NotificationTable
            WHERE EmpID = @empId
            ORDER BY CreatedDate DESC
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Notification fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// Mark as Read API
app.patch('/api/notifications/:notificationId/read', async (req, res) => {
    try {
        const { notificationId } = req.params;
        const { empId } = req.body;
        
        const request = pool.request();
        request.input('notificationId', sql.Int, notificationId);
        request.input('empId', sql.VarChar(30), empId);
        
        await request.query(`
            UPDATE NotificationTable 
            SET Status = 'read'
            WHERE NotificationID = @notificationId AND EmpID = @empId
        `);
        
        console.log(`NOTIFICATION READ: ${notificationId} marked as read by ${empId}`);
        res.json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('Notification update error:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});
// Utility function to simulate notifications
const sendNotification = async (empId, title, content, type = 'info') => {
    console.log(`NOTIFICATION: To ${empId} - ${title}: ${content} (${type})`);
};
// TEAM MANAGEMENT APIs

// 23.1 Get Team Members API
app.get('/api/team/members/:managerId', async (req, res) => {
    try {
        const { managerId } = req.params;
        
        const request = pool.request();
        request.input('managerId', sql.VarChar(30), managerId);
        
        const result = await request.query(`
            SELECT EmpID, Name, Position, Grade, DOJ
            FROM EmpProfileTable
            WHERE ManagerEmpID = @managerId
            ORDER BY Name
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Team members fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch team members' });
    }
});

// View Team Member Details API
app.get('/api/team/member/:managerId/:empId', async (req, res) => {
    try {
        const { managerId, empId } = req.params;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        request.input('managerId', sql.VarChar(30), managerId);
        
        const result = await request.query(`
            SELECT EmpID, Name, DOB, DOJ, Position, Grade
            FROM EmpProfileTable
            WHERE EmpID = @empId AND ManagerEmpID = @managerId
        `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Team member not found' });
        }
        
        res.json(result.recordset[0]);
    } catch (error) {
        console.error('Team member details error:', error);
        res.status(500).json({ error: 'Failed to fetch team member details' });
    }
});

// APPROVAL MANAGEMENT APIs

// Fetch Pending Approvals API
app.get('/api/approvals/pending/:managerId', async (req, res) => {
    try {
        const { managerId } = req.params;
        
        const request = pool.request();
        request.input('managerId', sql.VarChar(30), managerId);
        
        const result = await request.query(`
            SELECT 
                lr.LeaveReqID,
                lr.EmpID,
                ep.Name as EmployeeName,
                lr.FromDate,
                lr.ToDate,
                lr.Type,
                lr.RequestDate,
                'leave' as ApprovalType
            FROM LeaveReqTable lr
            JOIN EmpProfileTable ep ON lr.EmpID = ep.EmpID
            WHERE ep.ManagerEmpID = @managerId AND lr.Status = 'Pending'
            ORDER BY lr.RequestDate DESC
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Pending approvals error:', error);
        res.status(500).json({ error: 'Failed to fetch pending approvals' });
    }
});

// Approve/Reject Leave API
app.patch('/api/approvals/leave/:leaveReqId', async (req, res) => {
    try {
        const { leaveReqId } = req.params;
        const { action, remarks, managerId } = req.body;
        
        const status = action === 'approve' ? 'Approved' : 'Rejected';
        
        // Get leave request details
        const leaveRequest = pool.request();
        leaveRequest.input('leaveReqId', sql.Int, leaveReqId);
        
        const leaveResult = await leaveRequest.query(`
            SELECT lr.EmpID, ep.Name FROM LeaveReqTable lr
            JOIN EmpProfileTable ep ON lr.EmpID = ep.EmpID
            WHERE lr.LeaveReqID = @leaveReqId
        `);
        
        if (leaveResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Leave request not found' });
        }
        
        // Update leave request status
        const updateRequest = pool.request();
        updateRequest.input('leaveReqId', sql.Int, leaveReqId);
        updateRequest.input('status', sql.VarChar(15), status);
        
        await updateRequest.query(`
            UPDATE LeaveReqTable 
            SET Status = @status
            WHERE LeaveReqID = @leaveReqId
        `);
        
        // Send notification to employee
        const employeeId = leaveResult.recordset[0].EmpID;
        await sendNotification(employeeId, 'Leave Request Update', `Your leave request has been ${status.toLowerCase()}`, 'leave');
        
        console.log(`LEAVE APPROVAL: ${managerId} ${action}d leave request ${leaveReqId} for ${employeeId}`);
        res.json({ message: `Leave request ${status.toLowerCase()} successfully` });
    } catch (error) {
        console.error('Leave approval error:', error);
        res.status(500).json({ error: 'Failed to process leave approval' });
    }
});


// PERFORMANCE FEEDBACK APIs

// Submit Feedback API
app.post('/api/feedback/submit', async (req, res) => {
    try {
        const { reviewerId, empId, comments, score } = req.body;
        
        const request = pool.request();
        request.input('reviewerId', sql.VarChar(30), reviewerId);
        request.input('empId', sql.VarChar(30), empId);
        request.input('comments', sql.VarChar(500), comments);
        request.input('score', sql.Int, score);
        
        await request.query(`
            INSERT INTO FeedbackTable (ReviewerID, EmpID, Comments, Score, ReviewDate)
            VALUES (@reviewerId, @empId, @comments, @score, GETDATE())
        `);
        
        
        await sendNotification(empId, 'Performance Feedback', 'New performance feedback received', 'feedback');
        
        console.log(`FEEDBACK: ${reviewerId} submitted feedback for ${empId} with score ${score}`);
        res.json({ message: 'Feedback submitted successfully' });
    } catch (error) {
        console.error('Feedback submission error:', error);
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

// View Feedback History API
app.get('/api/feedback/history/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);
        
        const result = await request.query(`
            SELECT 
                f.FeedbackID,
                f.Comments,
                f.Score,
                f.ReviewDate,
                ep.Name as ReviewerName
            FROM FeedbackTable f
            JOIN EmpProfileTable ep ON f.ReviewerID = ep.EmpID
            WHERE f.EmpID = @empId
            ORDER BY f.ReviewDate DESC
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Feedback history error:', error);
        res.status(500).json({ error: 'Failed to fetch feedback history' });
    }
});


// UTILITY APIs

// Get all leave types
app.get('/api/leave/types', async (req, res) => {
    try {
        const request = pool.request();
        
        const result = await request.query(`
            SELECT LeaveID, Type, Description
            FROM LeaveTable
            ORDER BY Type
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Leave types error:', error);
        res.status(500).json({ error: 'Failed to fetch leave types' });
    }
});


// Get dashboard summary for employee
app.get('/api/dashboard/summary/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        const request = pool.request();
        request.input('empId', sql.VarChar(30), empId);

        const [leaveBalance, pendingReimb, unreadNotif, attendance] = await Promise.all([
            request.query(`
                SELECT COUNT(*) as TotalLeaves
                FROM LeaveReqTable
                WHERE EmpID = @empId AND Status = 'Approved' AND YEAR(FromDate) = YEAR(GETDATE())
            `),
            request.query(`
                SELECT COUNT(*) as PendingReimbursements
                FROM ReimbursementTable
                WHERE EmpID = @empId AND Status = 'Pending'
            `),
            request.query(`
                SELECT COUNT(*) as UnreadNotifications
                FROM NotificationTable
                WHERE EmpID = @empId AND Status = 'unread'
            `),
            request.query(`
                SELECT COUNT(*) as AttendanceDays
                FROM AttendanceTable
                WHERE EmpID = @empId AND MONTH(Date) = MONTH(GETDATE()) AND YEAR(Date) = YEAR(GETDATE())
            `)
        ]);

        res.json({
            leavesThisYear: leaveBalance.recordset[0].TotalLeaves,
            pendingReimbursements: pendingReimb.recordset[0].PendingReimbursements,
            unreadNotifications: unreadNotif.recordset[0].UnreadNotifications,
            attendanceThisMonth: attendance.recordset[0].AttendanceDays
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
});

// Get manager dashboard summary
app.get('/api/manager/dashboard/:managerId', async (req, res) => {
    try {
        const { managerId } = req.params;
        const request = pool.request();
        request.input('managerId', sql.VarChar(30), managerId);

        const [teamSize, pendingLeaves, pendingReimb, teamOnLeave] = await Promise.all([
            request.query(`SELECT COUNT(*) as TeamSize FROM EmpProfileTable WHERE ManagerEmpID = @managerId`),
            request.query(`
                SELECT COUNT(*) as PendingLeaves
                FROM LeaveReqTable lr
                JOIN EmpProfileTable ep ON lr.EmpID = ep.EmpID
                WHERE ep.ManagerEmpID = @managerId AND lr.Status = 'Pending'
            `),
            request.query(`
                SELECT COUNT(*) as PendingReimbursements
                FROM ReimbursementTable r
                JOIN EmpProfileTable ep ON r.EmpID = ep.EmpID
                WHERE ep.ManagerEmpID = @managerId AND r.Status = 'Pending'
            `),
            request.query(`
                SELECT COUNT(*) as TeamOnLeave
                FROM LeaveReqTable lr
                JOIN EmpProfileTable ep ON lr.EmpID = ep.EmpID
                WHERE ep.ManagerEmpID = @managerId 
                AND lr.Status = 'Approved' 
                AND GETDATE() BETWEEN lr.FromDate AND lr.ToDate
            `)
        ]);

        res.json({
            teamSize: teamSize.recordset[0].TeamSize,
            pendingLeaveApprovals: pendingLeaves.recordset[0].PendingLeaves,
            pendingReimbursementApprovals: pendingReimb.recordset[0].PendingReimbursements,
            teamOnLeaveToday: teamOnLeave.recordset[0].TeamOnLeave
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch manager dashboard' });
    }
});


// Search employees (for managers)
app.get('/api/employees/search/:managerId', async (req, res) => {
    try {
        const { managerId } = req.params;
        const { query } = req.query;

        const request = pool.request();
        request.input('managerId', sql.VarChar(30), managerId);
        request.input('searchQuery', sql.VarChar(100), `%${query}%`);

        const result = await request.query(`
            SELECT EmpID, Name, Position, Grade
            FROM EmpProfileTable
            WHERE ManagerEmpID = @managerId 
            AND (Name LIKE @searchQuery OR EmpID LIKE @searchQuery OR Position LIKE @searchQuery)
            ORDER BY Name
        `);

        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: 'Failed to search employees' });
    }
});


// Get employee attendance summary (for managers)
app.get('/api/team/attendance-summary/:managerId', async (req, res) => {
    try {
        const { month, year } = req.query;
        const { managerId } = req.params;

        const request = pool.request();
        request.input('managerId', sql.VarChar(30), managerId);
        request.input('month', sql.Int, month || new Date().getMonth() + 1);
        request.input('year', sql.Int, year || new Date().getFullYear());

        const result = await request.query(`
            SELECT 
                ep.EmpID,
                ep.Name,
                COUNT(at.Date) as WorkingDays,
                SUM(at.WorkingHours) as TotalHours,
                AVG(at.WorkingHours) as AvgHours
            FROM EmpProfileTable ep
            LEFT JOIN AttendanceTable at ON ep.EmpID = at.EmpID 
                AND MONTH(at.Date) = @month 
                AND YEAR(at.Date) = @year
            WHERE ep.ManagerEmpID = @managerId
            GROUP BY ep.EmpID, ep.Name
            ORDER BY ep.Name
        `);

        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch team attendance summary' });
    }
});


// Bulk approve/reject leave requests
app.patch('/api/approvals/leave/bulk', async (req, res) => {
    try {
        const { leaveRequestIds, action, remarks } = req.body;

        if (!Array.isArray(leaveRequestIds) || leaveRequestIds.length === 0) {
            return res.status(400).json({ error: 'No leave request IDs provided' });
        }

        const status = action === 'approve' ? 'Approved' : 'Rejected';
        const request = pool.request();
        request.input('status', sql.VarChar(15), status);

        const idParams = leaveRequestIds.map((id, index) => {
            const name = `id${index}`;
            request.input(name, sql.Int, id);
            return `@${name}`;
        });

        // Update query
        await request.query(`
            UPDATE LeaveReqTable
            SET Status = @status
            WHERE LeaveReqID IN (${idParams.join(',')})
        `);

        // Get employee IDs for notifications
        const empRequest = pool.request();
        leaveRequestIds.forEach((id, index) => {
            empRequest.input(`id${index}`, sql.Int, id);
        });

        const empResult = await empRequest.query(`
            SELECT DISTINCT EmpID FROM LeaveReqTable
            WHERE LeaveReqID IN (${idParams.join(',')})
        `);

        for (const emp of empResult.recordset) {
            await sendNotification(
                emp.EmpID,
                'Leave Request Update',
                `Your leave request has been ${status.toLowerCase()}`,
                'leave'
            );
        }

        res.json({ message: `${leaveRequestIds.length} leave requests ${status.toLowerCase()} successfully.` });
    } catch (error) {
        console.error('Bulk approval error:', error);
        res.status(500).json({ error: 'Failed to process bulk leave approval' });
    }
});

// ===========================================
// ERROR HANDLING MIDDLEWARE
// ===========================================

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});


// SERVER STARTUP


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Employee Management API Server running on port ${PORT}`);
});

module.exports = app;